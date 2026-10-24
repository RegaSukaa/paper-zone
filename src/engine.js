/* ============================================================================
 * engine.js — симуляция матча: непрерывное движение, след, столкновения.
 * Без DOM: тот же код идёт в браузере и в тестах.
 *
 * Порядок шага: решения ботов → поворот и движение подшагами → лобовые
 * столкновения → спавн в «Выживании» → условия конца матча.
 * ==========================================================================*/
(function (root, factory) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var deps = isNode
    ? { Core: require('./core.js'), AI: require('./ai.js').AI, PlayerMod: require('./player.js'), Skins: require('./skins.js') }
    : { Core: root.PIO, AI: root.PIO.AI, PlayerMod: root.PIO, Skins: root.PIO };
  var api = factory(deps);
  root.PIO = root.PIO || {};
  Object.assign(root.PIO, api);
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  var C = deps.Core;
  var AI = deps.AI;
  var Player = deps.PlayerMod.Player;
  var PHYS = C.PHYS;
  var SKINS = deps.Skins.SKINS;
  var skinById = deps.Skins.skinById;
  /* Ники ботов: короткие, «иo»-шные, без цифр и без обидного. */
  var BOT_NAMES = [
    'Кувалда', 'Пиксель', 'Вихрь', 'Шустрик', 'Ниндзя', 'Барон', 'Титан', 'Оса',
    'Фантом', 'Комета', 'Зефир', 'Кактус', 'Буран', 'Кобра', 'Магма', 'Нейрон',
    'Оникс', 'Пингвин', 'Ракета', 'Скарабей', 'Тайфун', 'Уголёк', 'Феникс', 'Хаос',
    'Циклон', 'Шершень', 'Юпитер', 'Ястреб', 'Барс', 'Гром', 'Дизель', 'Жнец',
    'Зигзаг', 'Импульс', 'Клинок', 'Лавина', 'Мираж', 'Прайд', 'Радар', 'Сокол'
  ];

  var MAX_PLAYERS = C.MAX_PLAYERS;
  var clamp = C.clamp;
  var bitOf = C.bitOf;
  var turnToward = C.turnToward;
  var dist2 = C.dist2;
  var TAU = C.TAU;

  var FIXED_STEP = 1 / 60;

  var MODE_INFO = {
    classic: { title: 'Классика', desc: 'Против ботов. Победа — 25% карты или все соперники.' },
    survival: { title: 'Выживание', desc: 'Соперники прибывают. Продержись 150 секунд.' },
    quick: { title: 'Быстрый матч', desc: '90 секунд. Побеждает больший процент территории.' },
    free: { title: 'Свободная игра', desc: 'Свои настройки: боты, размер карты, скорость.' }
  };

  var DEFAULTS = {
    mode: 'classic',
    difficulty: 'medium',
    mapW: 220,
    mapH: 220,
    botCount: 5,
    speed: PHYS.speed,
    playerSkin: 'mint',
    seed: 20261024,
    goalPercent: 25,
    survivalGoal: 150,
    timeLimit: 90,
    autopilot: false
  };

  class Game {
    constructor(cfg) {
      var c = Object.assign({}, DEFAULTS, cfg || {});
      this.cfg = c;
      this.mode = c.mode;
      this.difficulty = c.difficulty;
      this.rules = this.buildRules(c);
      this.grid = new C.Grid(c.mapW, c.mapH, MAX_PLAYERS);
      this.rng = C.mulberry32(c.seed >>> 0);
      this.players = [];
      this.time = 0;
      this.state = 'playing';
      this.result = null;
      this.events = [];
      this.nextSpawnAt = this.rules.spawnEvery || 0;
      this.spawnCount = 0;
      this.startSize = 9;
      this._disc = [];
      this._aliveList = [];
      this.respawns = [];
      this.setup();
    }

    buildRules(c) {
      var d = c.difficulty;
      switch (c.mode) {
        case 'survival':
          return { bots: 3, timeLimit: 0, survivalGoal: c.survivalGoal || 150,
            spawnEvery: 16, maxBots: 7, goalPercent: 0, difficulty: d };
        case 'quick':
          return { bots: 5, timeLimit: c.timeLimit || 90, survivalGoal: 0,
            spawnEvery: 0, maxBots: 5, goalPercent: 0, compare: true, difficulty: d };
        case 'free':
          return { bots: clamp(c.botCount | 0, 0, MAX_PLAYERS - 1), timeLimit: 0, survivalGoal: 0,
            spawnEvery: 0, maxBots: MAX_PLAYERS - 1, goalPercent: 0, difficulty: d };
        default:
          return { bots: 6, timeLimit: 0, survivalGoal: 0, spawnEvery: 0, maxBots: 6,
            goalPercent: c.goalPercent || 25, difficulty: d };
      }
    }

    /* ------------------------------ старт ------------------------------ */

    nextName() {
      if (!this._namePool || !this._namePool.length) {
        var pool = BOT_NAMES.slice();
        for (var i = pool.length - 1; i > 0; i--) {
          var j = Math.floor(this.rng() * (i + 1));
          var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
        }
        this._namePool = pool;
        this._nameUsed = 0;
      }
      return this._namePool[this._nameUsed++ % this._namePool.length];
    }

    setup() {
      var grid = this.grid;
      var total = this.rules.bots + 1;
      var size = this.startSize;
      var cx = grid.w / 2, cy = grid.h / 2;
      var radius = Math.min(grid.w, grid.h) * 0.3;
      var baseAngle = this.rng() * TAU;
      var used = [this.cfg.playerSkin];

      for (var i = 0; i < total; i++) {
        var ang = baseAngle + (i / total) * TAU;
        var px = Math.round(cx + Math.cos(ang) * radius);
        var py = Math.round(cy + Math.sin(ang) * radius);
        px = clamp(px, size + 6, grid.w - size - 6);
        py = clamp(py, size + 6, grid.h - size - 6);
        var isHuman = i === 0;
        var skin = isHuman ? this.cfg.playerSkin : this.pickSkin(used);
        if (!isHuman) used.push(skin);
        var inward = Math.atan2(cy - py, cx - px);
        this.addPlayer({
          id: i + 1, isBot: !isHuman || !!this.cfg.autopilot,
          name: isHuman ? 'Ты' : this.nextName(),
          x: px + 0.5, y: py + 0.5, angle: inward, skinId: skin, startSize: size
        });
      }
    }

    pickSkin(used) {
      for (var k = 0; k < SKINS.length; k++) {
        var cand = SKINS[(used.length + k) % SKINS.length];
        if (used.indexOf(cand.id) === -1) return cand.id;
      }
      return SKINS[used.length % SKINS.length].id;
    }

    addPlayer(o) {
      var skinDef = skinById(o.skinId);
      var speed = (o.baseSpeed || this.cfg.speed) * (o.isBot ? AI.LEVELS[this.difficulty].speed : 1);
      var p = new Player(o.id, {
        isBot: o.isBot, name: o.name, x: o.x, y: o.y, angle: o.angle,
        skinId: o.skinId, palette: skinDef, speed: speed
      });
      p.spawnAt = this.time;
      var hs = Math.floor((o.startSize || this.startSize) / 2);
      this.grid.claimRect(p.cx - hs, p.cy - hs, (o.startSize || this.startSize), (o.startSize || this.startSize), p.id);
      this.players.push(p);
      if (p.isBot) {
        p.bot = new AI.BotBrain(this, p, this.difficulty);
        p.brainState = p.bot.state;
      }
      this.events.push({ type: 'spawn', id: p.id, isBot: p.isBot, x: p.x, y: p.y });
      return p;
    }

    /* --------------------------- управление ----------------------------- */

    setTargetAngle(id, angle) {
      var p = this.playerById(id);
      if (!p || !p.alive || !isFinite(angle)) return;
      p.wantAngle = angle;
    }

    steer(angle) {
      var p = this.players[0];
      if (!p || !p.alive || !isFinite(angle)) return;
      p.wantAngle = angle;
    }

    playerById(id) {
      for (var i = 0; i < this.players.length; i++) if (this.players[i].id === id) return this.players[i];
      return null;
    }

    get human() { return this.players[0] || null; }

    /* ------------------------------ шаг -------------------------------- */

    step(dt) {
      if (this.state !== 'playing' || !(dt > 0)) return;
      this.time += dt;

      var i, p;
      for (i = 0; i < this.players.length; i++) {
        p = this.players[i];
        if (p.alive && p.isBot && p.bot) {
          p.bot.think(dt);
          p.brainState = p.bot.state;
        }
      }
      for (i = 0; i < this.players.length; i++) {
        p = this.players[i];
        if (p.alive) this.movePlayer(p, dt);
      }
      this.resolveHeadCollisions();
      this.updateRespawns();
      if (this.mode === 'survival') this.updateSurvival();
      this.checkEnd();
    }

    movePlayer(p, dt) {
      p.angle = turnToward(p.angle, p.wantAngle, PHYS.turnRate * dt);
      var dist = p.speed * dt;
      var steps = Math.max(1, Math.ceil(dist / PHYS.substep));
      var stepLen = dist / steps;
      var dx = Math.cos(p.angle) * stepLen;
      var dy = Math.sin(p.angle) * stepLen;
      for (var s = 0; s < steps; s++) {
        p.x += dx;
        p.y += dy;
        this.advance(p);
        if (!p.alive) return;
      }
    }

    /* Один подшаг: границы, столкновения, штамп следа, замыкание. */
    advance(p) {
      var g = this.grid;
      var R = p.radius;
      if (p.x < R || p.y < R || p.x > g.w - R || p.y > g.h - R) {
        p.x = clamp(p.x, R, g.w - R);
        p.y = clamp(p.y, R, g.h - R);
        this.kill(p, 'wall');
        return;
      }
      var cx = p.cx, cy = p.cy;
      if (g.isWall(cx, cy)) { this.kill(p, 'wall'); return; }

      // столкновения считаем по «ядру» головы: касание должно быть реальным,
      // иначе трёхклеточный след убивает при простом проезде рядом
      var cells = g.discCells(p.x, p.y, 0.55, this._disc);

      // 1. задеть чужой след головой — владелец погибает
      var anyOther = false;
      var ownBit = bitOf(p.id);
      for (var a = 0; a < cells.length; a++) {
        if (g.trail[cells[a]] & ~ownBit) { anyOther = true; break; }
      }
      if (anyOther) {
        for (var q = 0; q < this.players.length; q++) {
          var other = this.players[q];
          if (!other.alive || other.id === p.id) continue;
          var ob = bitOf(other.id);
          for (var b = 0; b < cells.length; b++) {
            if (g.trail[cells[b]] & ob) { this.kill(other, 'cut', p); break; }
          }
        }
      }

      // 2. собственный след (кроме «хвоста» под головой)
      for (var k = 0; k < cells.length; k++) {
        var idx = cells[k];
        if ((g.trail[idx] & ownBit) && !p.recent.has(idx)) {
          var ox = (idx % g.w) + 0.5, oy = Math.floor(idx / g.w) + 0.5;
          p.selfDebug = {
            cell: [+ox.toFixed(1), +oy.toFixed(1)],
            dist: +Math.sqrt(dist2(p.x, p.y, ox, oy)).toFixed(2),
            trail: p.trail.size, recent: p.recent.size, stamps: p.stamps.length,
            speed: p.speed
          };
          this.kill(p, 'self');
          return;
        }
      }

      // 3. вернулись на свою землю — замыкаем контур
      if (g.ownerAt(cx, cy) === p.id) {
        if (p.trailing && p.trail.size > 0) this.closeTrail(p);
        else p.clearTrail();
        return;
      }

      // 4. тянем тонкий след по отрезку от прошлой точки
      if (!p.trailing) {
        p.beginTrail();
        p.trailPath.push({ x: p.x, y: p.y });
        p.px = p.x;
        p.py = p.y;
      }
      g.stampLine(p.px, p.py, p.x, p.y, p.id, cells);
      p.px = p.x;
      p.py = p.y;
      p.pushStamp(cells, g.w);
      for (var m = 0; m < cells.length; m++) p.trail.add(cells[m]);
      var last = p.trailPath[p.trailPath.length - 1];
      if (!last || dist2(last.x, last.y, p.x, p.y) > 0.06) {
        p.trailPath.push({ x: p.x, y: p.y });
      }
    }

    closeTrail(p) {
      var res = this.grid.closeTrail(p.id);
      p.clearTrail();
      p.capturedTotal += res.capturedCount;
      this.events.push({
        type: 'capture', id: p.id, count: res.capturedCount,
        enclosed: res.enclosed, trail: res.trail,
        percent: this.grid.percent(p.id), x: p.x, y: p.y
      });
      this.trimEvents();
    }

    kill(p, cause, killer) {
      if (!p.alive) return;
      p.alive = false;
      p.deathAt = this.time;
      p.deathCause = cause;
      this.grid.clearTrail(p.id);
      p.clearTrail();
      if (killer && killer.alive && killer.id !== p.id) {
        this.grid.transferTerritory(p.id, killer.id);
      } else if (p.id !== 1) {
        this.grid.releaseTerritory(p.id);
      }
      if (killer && killer.alive && killer.id !== p.id) killer.kills++;
      if (p.bot) p.bot = null;
      if (p.isBot && p.id !== 1) this.respawns.push({ player: p, at: this.time + 6 });
      this.events.push({
        type: 'death', id: p.id, cause: cause,
        killer: killer ? killer.id : 0, x: p.x, y: p.y, isBot: p.isBot,
        angle: p.angle
      });
      this.trimEvents();
    }

    /* Лобовое столкновение гибельно только вне своей территории. */
    resolveHeadCollisions() {
      var alive = this._aliveList;
      alive.length = 0;
      for (var i = 0; i < this.players.length; i++) {
        if (this.players[i].alive) alive.push(this.players[i]);
      }
      var reach = (PHYS.headRadius * 2) * 0.86;
      var lim = reach * reach;
      for (var a = 0; a < alive.length; a++) {
        for (var b = a + 1; b < alive.length; b++) {
          var p = alive[a], q = alive[b];
          if (!p.alive || !q.alive) continue;
          var pSafe = this.grid.ownerAt(p.cx, p.cy) === p.id;
          var qSafe = this.grid.ownerAt(q.cx, q.cy) === q.id;
          if (pSafe || qSafe) continue;
          if (dist2(p.x, p.y, q.x, q.y) <= lim) {
            this.kill(p, 'head');
            this.kill(q, 'head');
          }
        }
      }
    }

    /* ---------------------------- состояние ---------------------------- */

    /* Погибшие боты возвращаются через несколько секунд: арена должна жить,
     * а победа не может доставаться за «переждать». */
    updateRespawns() {
      if (!this.respawns.length) return;
      for (var i = this.respawns.length - 1; i >= 0; i--) {
        var r = this.respawns[i];
        if (this.time < r.at) continue;
        if (r.player.alive) { this.respawns.splice(i, 1); continue; }
        if (this.aliveBots().length >= this.rules.bots + (this.mode === 'survival' ? 4 : 0)) {
          r.at = this.time + 2;
          continue;
        }
        if (this.respawnBot(r.player)) this.respawns.splice(i, 1);
        else r.at = this.time + 1.5;
      }
    }

    respawnBot(p) {
      var g = this.grid;
      var size = this.startSize;
      var hs = Math.floor(size / 2);
      for (var tries = 0; tries < 90; tries++) {
        var x = hs + 5 + Math.floor(this.rng() * (g.w - size - 10));
        var y = hs + 5 + Math.floor(this.rng() * (g.h - size - 10));
        var free = true;
        for (var yy = y - hs; yy <= y + hs && free; yy++) {
          for (var xx = x - hs; xx <= x + hs; xx++) {
            if (!g.inBounds(xx, yy) || g.ownerAt(xx, yy) !== 0 || g.trailAt(xx, yy) !== 0 || g.isWall(xx, yy)) {
              free = false; break;
            }
          }
        }
        if (!free) continue;
        p.x = x + 0.5;
        p.y = y + 0.5;
        p.angle = this.rng() * TAU;
        p.wantAngle = p.angle;
        p.alive = true;
        p.deathCause = null;
        p.deathAt = 0;
        p.clearTrail();
        p.capturedTotal = 0;
        p.spawnAt = this.time;
        g.claimRect(x - hs, y - hs, size, size, p.id);
        p.bot = new AI.BotBrain(this, p, this.difficulty);
        p.brainState = p.bot.state;
        this.events.push({ type: 'spawn', id: p.id, isBot: true, x: p.x, y: p.y, respawn: true });
        return true;
      }
      return false;
    }

    updateSurvival() {
      if (!this.rules.spawnEvery) return;
      if (this.time < this.nextSpawnAt) return;
      if (this.aliveBots().length >= this.rules.maxBots) return;
      this.nextSpawnAt = this.time + this.rules.spawnEvery;
      this.spawnBot();
    }

    spawnBot() {
      var g = this.grid;
      var used = this.players.map(function (p) { return p.id; });
      var id = 0;
      for (var k = 2; k <= MAX_PLAYERS; k++) if (used.indexOf(k) === -1) { id = k; break; }
      if (!id) return null;

      var size = Math.max(7, this.startSize - 2);
      var hs = Math.floor(size / 2);
      for (var tries = 0; tries < 80; tries++) {
        var x = hs + 4 + Math.floor(this.rng() * (g.w - size - 8));
        var y = hs + 4 + Math.floor(this.rng() * (g.h - size - 8));
        var free = true;
        for (var yy = y - hs; yy <= y + hs && free; yy++) {
          for (var xx = x - hs; xx <= x + hs; xx++) {
            if (!g.inBounds(xx, yy) || g.ownerAt(xx, yy) !== 0 || g.trailAt(xx, yy) !== 0 || g.isWall(xx, yy)) {
              free = false; break;
            }
          }
        }
        if (!free) continue;
        var level = this.time > 70 ? 'hard' : (this.time > 35 ? 'medium' : this.difficulty);
        var p = this.addPlayer({
          id: id, isBot: true, name: this.nextName(),
          x: x + 0.5, y: y + 0.5, angle: this.rng() * TAU,
          skinId: this.pickSkin(this.players.map(function (q) { return q.skinId; })),
          startSize: size
        });
        if (p.bot) {
          p.bot.level = AI.LEVELS[level] ? level : 'medium';
          p.bot.cfg = AI.LEVELS[p.bot.level];
        }
        this.spawnCount++;
        return p;
      }
      return null;
    }

    aliveBots() {
      var out = [];
      for (var i = 1; i < this.players.length; i++) if (this.players[i].alive) out.push(this.players[i]);
      return out;
    }

    bestBotPercent() {
      var best = 0;
      for (var i = 1; i < this.players.length; i++) {
        if (!this.players[i].alive) continue;
        var pc = this.grid.percent(this.players[i].id);
        if (pc > best) best = pc;
      }
      return best;
    }

    percent(id) { return this.grid.percent(id); }

    stats() {
      return {
        percent: this.grid.percent(1),
        cells: this.grid.ownerCount(1),
        kills: this.players[0].kills,
        time: this.time,
        botsAlive: this.aliveBots().length,
        bestBotPercent: this.bestBotPercent(),
        score: this.score()
      };
    }

    score() {
      var st = this.grid.percent(1);
      var k = this.players[0] ? this.players[0].kills : 0;
      var t = (this.state === 'over' && this.result) ? this.result.time : this.time;
      return Math.round(st * 100 + k * 200 + t * 2);
    }

    checkEnd() {
      if (this.state !== 'playing') return;
      var human = this.players[0];
      if (!human || !human.alive) {
        if (this.cfg.autopilot) return;
        this.end(false, human && human.deathCause === 'wall' ? 'wall' : 'died');
        return;
      }
      var rules = this.rules;
      if (rules.timeLimit && this.time >= rules.timeLimit) {
        var mine = this.grid.percent(1);
        var best = this.bestBotPercent();
        this.end(mine >= best, 'time', { bestBotPercent: best });
        return;
      }
      if (rules.survivalGoal && this.time >= rules.survivalGoal) {
        this.end(true, 'survived');
        return;
      }
      if (rules.goalPercent && this.grid.percent(1) >= rules.goalPercent) {
        this.end(true, 'goal');
      }
    }

    end(win, reason, extra) {
      if (this.state === 'over') return;
      this.state = 'over';
      var human = this.players[0];
      var percent = this.grid.percent(1);
      this.result = Object.assign({
        win: !!win, reason: reason, percent: percent,
        cells: this.grid.ownerCount(1), time: this.time,
        kills: human ? human.kills : 0,
        botsAlive: this.aliveBots().length,
        bestBotPercent: this.bestBotPercent(),
        mode: this.mode, difficulty: this.difficulty,
        score: Math.round(percent * 100 + (human ? human.kills : 0) * 200 + this.time * 2)
      }, extra || {});
      this.events.push({ type: 'end', result: this.result });
    }

    drainEvents() {
      var out = this.events;
      this.events = [];
      return out;
    }

    trimEvents() {
      if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
    }
  }

  return { Game: Game, FIXED_STEP: FIXED_STEP, MODE_INFO: MODE_INFO, DEFAULTS: DEFAULTS };
});
