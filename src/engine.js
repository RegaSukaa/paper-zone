/* ============================================================================
 * engine.js — симуляция матча. Без DOM: тот же код идёт в браузере и в тестах.
 *
 * Порядок внутри шага (детерминированный):
 *   1) решения ботов  2) движение и входы в клетки  3) лобовые столкновения
 *   4) спавн в «Выживании»  5) условия конца матча
 * ==========================================================================*/
(function (root, factory) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var deps = isNode
    ? { Core: require('./core.js'), AI: require('./ai.js').AI }
    : { Core: root.PIO, AI: root.PIO.AI };
  var api = factory(deps);
  root.PIO = root.PIO || {};
  Object.assign(root.PIO, api);
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  var C = deps.Core;
  var AI = deps.AI;
  var DIRS = C.DIRS;
  var SKINS = C.SKINS;
  var MAX_PLAYERS = C.MAX_PLAYERS;
  var clamp = C.clamp;
  var bitOf = C.bitOf;

  var FIXED_STEP = 1 / 60;

  var MODE_INFO = {
    classic: { title: 'Классика', desc: 'Против ботов. Победа — 60% карты или все соперники.' },
    survival: { title: 'Выживание', desc: 'Соперники прибывают. Продержись 150 секунд.' },
    quick: { title: 'Быстрый матч', desc: '90 секунд. Побеждает больший процент территории.' },
    free: { title: 'Свободная игра', desc: 'Свои настройки: боты, размер карты, скорость.' }
  };

  var DEFAULTS = {
    mode: 'classic',
    difficulty: 'medium',
    mapW: 150,
    mapH: 150,
    botCount: 5,
    speed: 11,
    playerSkin: 0,
    seed: 20261023,
    goalPercent: 60,
    survivalGoal: 150,
    timeLimit: 90,
    autopilot: false
  };

  class Player {
    constructor(id, o) {
      this.id = id;
      this.isBot = !!o.isBot;
      this.name = o.name || (o.isBot ? 'Бот ' + id : 'Игрок');
      this.alive = true;
      this.skin = o.skin || 0;
      this.colors = SKINS[this.skin % SKINS.length];
      this.x = o.x;
      this.y = o.y;
      this.cx = Math.floor(o.x);
      this.cy = Math.floor(o.y);
      this.prevCx = this.cx;
      this.prevCy = this.cy;
      this.dir = o.dir || DIRS[0];
      this.nextDir = this.dir;
      this.speed = o.speed;
      this.trailing = false;
      this.trailCells = new Set();
      this.trailPath = [];
      this.kills = 0;
      this.deathAt = 0;
      this.deathCause = null;
      this.bot = null;
      this.brainState = 'IDLE';
      this.capturedTotal = 0;
    }
  }

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
      this.startSize = 7;
      this.setup();
    }

    buildRules(c) {
      var difficulty = c.difficulty;
      switch (c.mode) {
        case 'survival':
          return {
            bots: 3, timeLimit: 0, survivalGoal: c.survivalGoal || 150,
            spawnEvery: 16, maxBots: 7, goalPercent: 0, difficulty: difficulty
          };
        case 'quick':
          return {
            bots: 5, timeLimit: c.timeLimit || 90, survivalGoal: 0,
            spawnEvery: 0, maxBots: 5, goalPercent: 0, compare: true, difficulty: difficulty
          };
        case 'free':
          return {
            bots: clamp(c.botCount | 0, 0, MAX_PLAYERS - 1), timeLimit: 0, survivalGoal: 0,
            spawnEvery: 0, maxBots: MAX_PLAYERS - 1, goalPercent: 0, difficulty: difficulty
          };
        default:
          return {
            bots: 5, timeLimit: 0, survivalGoal: 0, spawnEvery: 0, maxBots: 5,
            goalPercent: c.goalPercent || 60, difficulty: difficulty
          };
      }
    }

    /* ------------------------------ старт ------------------------------ */

    setup() {
      var grid = this.grid;
      var total = this.rules.bots + 1;
      var size = this.startSize = Math.max(5, Math.round(Math.min(grid.w, grid.h) * 0.05));
      var cx = grid.w / 2, cy = grid.h / 2;
      var radius = Math.min(grid.w, grid.h) * 0.3;
      var baseAngle = this.rng() * Math.PI * 2;
      var usedSkins = [this.cfg.playerSkin | 0];

      for (var i = 0; i < total; i++) {
        var ang = baseAngle + (i / total) * Math.PI * 2;
        var px = Math.round(cx + Math.cos(ang) * radius);
        var py = Math.round(cy + Math.sin(ang) * radius);
        px = clamp(px, size + 2, grid.w - size - 3);
        py = clamp(py, size + 2, grid.h - size - 3);
        var isHuman = i === 0;
        var skin;
        if (isHuman) {
          skin = this.cfg.playerSkin | 0;
        } else {
          skin = this.pickSkin(usedSkins);
          usedSkins.push(skin);
        }
        // направление наружу от центра
        var ox = px - cx, oy = py - cy;
        var dir = Math.abs(ox) > Math.abs(oy)
          ? (ox > 0 ? DIRS[0] : DIRS[2])
          : (oy > 0 ? DIRS[1] : DIRS[3]);

        this.addPlayer({
          id: i + 1, isBot: !isHuman || !!this.cfg.autopilot,
          name: isHuman ? 'Ты' : 'Бот ' + (i),
          x: px + 0.5, y: py + 0.5, dir: dir, skin: skin, startSize: size
        });
      }
    }

    pickSkin(used) {
      for (var k = 0; k < SKINS.length; k++) {
        var cand = (used.length + k) % SKINS.length;
        if (used.indexOf(cand) === -1) return cand;
      }
      return used.length % SKINS.length;
    }

    addPlayer(o) {
      var speed = (o.baseSpeed || this.cfg.speed) * (o.isBot ? AI.LEVELS[this.difficulty].speed : 1);
      var p = new Player(o.id, {
        isBot: o.isBot, name: o.name, x: o.x, y: o.y, dir: o.dir,
        skin: o.skin, speed: speed
      });
      var hs = Math.floor((o.startSize || this.startSize) / 2);
      var x0 = p.cx - hs, y0 = p.cy - hs;
      var sz = (o.startSize || this.startSize);
      this.grid.claimRect(x0, y0, sz, sz, p.id);
      this.players.push(p);
      if (p.isBot) {
        p.bot = new AI.BotBrain(this, p, this.difficulty);
        p.brainState = p.bot.state;
      }
      this.events.push({ type: 'spawn', id: p.id, isBot: p.isBot, x: p.cx, y: p.cy });
      return p;
    }

    /* --------------------------- ввод игрока --------------------------- */

    setDirection(id, dir) {
      var p = this.playerById(id);
      if (!p || !p.alive) return;
      if (dir && typeof dir.x === 'number' && typeof dir.y === 'number') {
        p.nextDir = dir;
      }
    }

    steerHuman(dir) {
      var p = this.players[0];
      if (!p || !p.alive) return;
      p.nextDir = dir;
    }

    playerById(id) {
      for (var i = 0; i < this.players.length; i++) if (this.players[i].id === id) return this.players[i];
      return null;
    }

    get human() { return this.players[0] || null; }

    /* ------------------------------ шаг ------------------------------- */

    step(dt) {
      if (this.state !== 'playing') return;
      if (!(dt > 0)) return;
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
        if (!p.alive) continue;
        p.prevCx = p.cx;
        p.prevCy = p.cy;
        this.movePlayer(p, dt);
      }
      this.resolveHeadCollisions();
      if (this.mode === 'survival') this.updateSurvival();
      this.checkEnd();
    }

    movePlayer(p, dt) {
      if (!p.alive) return;
      var nd = p.nextDir;
      if (nd && nd !== p.dir) {
        var reverse = (nd.x === -p.dir.x && nd.y === -p.dir.y);
        if (!(reverse && p.trailing)) p.dir = nd;
      }
      var travel = p.speed * dt;
      var guard = 0;
      while (travel > 1e-6 && p.alive && guard++ < 64) {
        var chunk = Math.min(travel, 0.3);
        travel -= chunk;
        p.x += p.dir.x * chunk;
        p.y += p.dir.y * chunk;
        var cx = Math.floor(p.x), cy = Math.floor(p.y);
        if (cx !== p.cx || cy !== p.cy) {
          if (!this.enterCell(p, cx, cy)) return;
        }
      }
    }

    enterCell(p, cx, cy) {
      var g = this.grid;
      if (!g.inBounds(cx, cy) || g.isWall(cx, cy)) {
        this.kill(p, 'wall');
        return false;
      }
      var own = bitOf(p.id);
      var bits = g.trailAt(cx, cy);

      // Пересечение чужого следа: владелец следа погибает.
      if (bits & ~own) {
        for (var i = 0; i < this.players.length; i++) {
          var q = this.players[i];
          if (!q.alive || q.id === p.id) continue;
          if (g.hasTrailIdx(cy * g.w + cx, q.id)) this.kill(q, 'cut', p);
        }
      }
      // Свой след — смерть (проверяется после чужих: оба события возможны).
      if (bits & own) {
        this.kill(p, 'self');
        return false;
      }

      p.cx = cx;
      p.cy = cy;

      if (g.ownerAt(cx, cy) === p.id) {
        if (p.trailCells.size > 0) this.closeTrail(p);
        p.trailing = false;
      } else {
        if (!p.trailing) {
          p.trailing = true;
          p.trailPath.push({ x: p.x - p.dir.x * 0.5, y: p.y - p.dir.y * 0.5 });
        }
        if (g.addTrailIdx(cy * g.w + cx, p.id)) {
          p.trailCells.add(cy * g.w + cx);
        }
        var last = p.trailPath[p.trailPath.length - 1];
        if (!last || last.x !== cx + 0.5 || last.y !== cy + 0.5) {
          p.trailPath.push({ x: cx + 0.5, y: cy + 0.5 });
        }
      }
      return true;
    }

    closeTrail(p) {
      var res = this.grid.closeTrail(p.id);
      p.trailCells.clear();
      p.trailPath.length = 0;
      p.trailing = false;
      p.capturedTotal += res.capturedCount;
      this.events.push({
        type: 'capture', id: p.id, count: res.capturedCount,
        enclosed: res.enclosed, trail: res.trail,
        percent: this.grid.percent(p.id)
      });
    }

    kill(p, cause, killer) {
      if (!p.alive) return;
      p.alive = false;
      p.trailing = false;
      p.deathAt = this.time;
      p.deathCause = cause;
      this.grid.clearTrail(p.id);
      p.trailCells.clear();
      p.trailPath.length = 0;
      // Территория погибшего бота уходит в нейтраль, у игрока сохраняется
      // до экрана результатов (матч всё равно закончен).
      if (p.id !== 1) this.grid.releaseTerritory(p.id);
      if (killer && killer.alive && killer.id !== p.id) killer.kills++;
      if (p.bot) p.bot = null;
      this.events.push({
        type: 'death', id: p.id, cause: cause,
        killer: killer ? killer.id : 0, x: p.x, y: p.y, isBot: p.isBot
      });
      this.trimEvents();
    }

    /* Лобовое столкновение гибельно только для игроков вне своей территории:
     * «внутри своей земли ты в безопасности» (правило оригинала). */
    resolveHeadCollisions() {
      var alive = [];
      for (var i = 0; i < this.players.length; i++) if (this.players[i].alive) alive.push(this.players[i]);
      for (var a = 0; a < alive.length; a++) {
        for (var b = a + 1; b < alive.length; b++) {
          var p = alive[a], q = alive[b];
          if (!p.alive || !q.alive) continue;
          var pSafe = this.grid.ownerAt(p.cx, p.cy) === p.id;
          var qSafe = this.grid.ownerAt(q.cx, q.cy) === q.id;
          if (pSafe || qSafe) continue;
          var same = p.cx === q.cx && p.cy === q.cy;
          var swapped = p.prevCx === q.cx && p.prevCy === q.cy &&
                        q.prevCx === p.cx && q.prevCy === p.cy;
          if (same || swapped) {
            this.kill(p, same ? 'head' : 'swap');
            this.kill(q, same ? 'head' : 'swap');
          }
        }
      }
    }

    updateSurvival() {
      if (!this.rules.spawnEvery) return;
      if (this.time < this.nextSpawnAt) return;
      var aliveBots = this.aliveBots().length;
      if (aliveBots >= this.rules.maxBots) return;
      this.nextSpawnAt = this.time + this.rules.spawnEvery;
      this.spawnBot();
    }

    spawnBot() {
      var g = this.grid;
      var used = [];
      for (var i = 0; i < this.players.length; i++) used.push(this.players[i].id);
      var id = 0;
      for (var k = 2; k <= MAX_PLAYERS; k++) if (used.indexOf(k) === -1) { id = k; break; }
      if (!id) return null;

      var size = Math.max(5, this.startSize - 2);
      var hs = Math.floor(size / 2);
      for (var tries = 0; tries < 60; tries++) {
        var x = hs + 2 + Math.floor(this.rng() * (g.w - size - 4));
        var y = hs + 2 + Math.floor(this.rng() * (g.h - size - 4));
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
          id: id, isBot: true, name: 'Бот ' + id,
          x: x + 0.5, y: y + 0.5,
          dir: DIRS[Math.floor(this.rng() * 4)],
          skin: this.pickSkin(this.players.map(function (q) { return q.skin; })),
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

    /* ---------------------------- состояние ---------------------------- */

    aliveBots() {
      var out = [];
      for (var i = 1; i < this.players.length; i++) if (this.players[i].alive) out.push(this.players[i]);
      return out;
    }

    bestBotPercent() {
      var best = 0;
      for (var i = 1; i < this.players.length; i++) {
        var p = this.players[i];
        if (!p.alive) continue;
        var pc = this.grid.percent(p.id);
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
      var t = this.state === 'over' && this.result ? this.result.time : this.time;
      return Math.round(st * 100 + k * 200 + t * 2);
    }

    checkEnd() {
      if (this.state !== 'playing') return;
      var human = this.players[0];
      if (!human || !human.alive) {
        if (this.cfg.autopilot) {
          // Демо-режим: матч продолжается без игрока (используется тестами ИИ).
          return;
        }
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
      if (this.mode === 'classic' && this.aliveBots().length === 0) {
        this.end(true, 'lastman');
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
        win: !!win,
        reason: reason,
        percent: percent,
        cells: this.grid.ownerCount(1),
        time: this.time,
        kills: human ? human.kills : 0,
        botsAlive: this.aliveBots().length,
        bestBotPercent: this.bestBotPercent(),
        mode: this.mode,
        difficulty: this.difficulty,
        score: Math.round(percent * 100 + (human ? human.kills : 0) * 200 + this.time * 2)
      }, extra || {});
      this.events.push({ type: 'end', result: this.result });
    }

    /* ------------------------------ события ----------------------------- */

    drainEvents() {
      var out = this.events;
      this.events = [];
      return out;
    }

    trimEvents() {
      if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
    }
  }

  return { Game: Game, Player: Player, FIXED_STEP: FIXED_STEP, MODE_INFO: MODE_INFO, DEFAULTS: DEFAULTS };
});
