/* ============================================================================
 * ai.js — поведение ботов. Модуль без DOM, тестируется в Node.
 *
 * Бот видит только то, что видно игроку: сетку владельцев, следы и головы.
 * Никаких телепортаций и «читерских» данных: решения — это выбор одного из
 * четырёх направлений на основе оценки опасности и цели.
 *
 * Состояния: EXPAND, PATROL, RETURN, EVADE, ATTACK, DEFEND.
 * ==========================================================================*/
(function (root, factory) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var deps = isNode ? require('./core.js') : root.PIO;
  var api = factory(deps);
  root.PIO = root.PIO || {};
  Object.assign(root.PIO, api);
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';

  var DIRS = C.DIRS;
  var bitOf = C.bitOf;

  /* Три уровня: отличаются не только скоростью, но и риском, агрессией,
   * горизонтом зрения и частотой решений. */
  var LEVELS = {
    easy: {
      risk: 5, aggression: 0.10, vision: 9, interval: 0.14,
      speed: 0.90, goalDist: 7, patience: 3.6, edgeFear: 34, attackTrailRatio: 0.35
    },
    medium: {
      risk: 10, aggression: 0.36, vision: 14, interval: 0.08,
      speed: 1.00, goalDist: 12, patience: 2.6, edgeFear: 28, attackTrailRatio: 0.5
    },
    hard: {
      risk: 17, aggression: 0.66, vision: 20, interval: 0.05,
      speed: 1.06, goalDist: 17, patience: 1.9, edgeFear: 22, attackTrailRatio: 0.7
    }
  };

  class BotBrain {
    constructor(game, player, level) {
      this.game = game;
      this.p = player;
      this.level = LEVELS[level] ? level : 'medium';
      this.cfg = LEVELS[this.level];
      this.timer = 0;
      this.goal = null;
      this.goalTime = 0;
      this.state = 'EXPAND';
      this.lastCell = -1;
      this.stuck = 0;
      this.wander = 0;
    }

    think(dt) {
      var p = this.p;
      var g = this.game.grid;
      if (!p.alive) return;
      this.timer -= dt;
      this.goalTime -= dt;
      this.wander -= dt;
      if (this.timer > 0) return;
      this.timer = this.cfg.interval;

      var cell = p.cy * g.w + p.cx;
      if (cell === this.lastCell) {
        this.stuck += this.cfg.interval;
      } else {
        this.stuck = 0;
        this.lastCell = cell;
      }

      if (!this.goal || this.goalTime <= 0 || this.nearGoal() || this.stuck > 0.5) {
        this.pickGoal();
      }
      var dir = this.chooseDir();
      if (dir) this.game.setDirection(p.id, dir);
    }

    nearGoal() {
      if (!this.goal) return true;
      var p = this.p;
      return Math.abs(this.goal.x - p.cx) + Math.abs(this.goal.y - p.cy) <= 1;
    }

    /* ---------------- выбор цели / состояния ---------------- */

    pickGoal() {
      var p = this.p;
      var g = this.game.grid;
      var trailLen = p.trailCells.size;

      // 1. Опасность: враг рядом с нашим следом — срочно домой.
      if (trailLen > 2 && this.enemyNearTrail(9)) {
        this.goHome('EVADE');
        return;
      }
      // 2. След стал длинным — закрываем.
      if (trailLen > this.cfg.risk) {
        this.goHome('RETURN');
        return;
      }
      // 3. Атака: пересечь открытый след врага (он погибает).
      if (trailLen <= this.cfg.risk * this.cfg.attackTrailRatio &&
          this.game.rng() < this.cfg.aggression + 0.05) {
        var target = this.findEnemyTrail();
        if (target) {
          this.goal = target;
          this.goalTime = 2.6;
          this.state = 'ATTACK';
          return;
        }
      }
      // 4. Защита: враг стоит на нашей территории — идём на перехват.
      var intruder = this.enemyOnMyLand();
      if (intruder && trailLen < 3) {
        this.goal = {
          x: C.clamp(intruder.cx + intruder.dir.x * 4, 2, g.w - 3),
          y: C.clamp(intruder.cy + intruder.dir.y * 4, 2, g.h - 3)
        };
        this.goalTime = 2.2;
        this.state = 'DEFEND';
        return;
      }
      // 5. Расширение. Если уже идём к цели вне территории — не дёргаемся.
      if (this.goal && trailLen > 0) {
        this.goalTime = Math.max(this.goalTime, this.cfg.patience * 0.6);
        this.state = 'EXPAND';
        return;
      }
      // 6. Патруль по своей земле, если расширяться некуда.
      if (this.expandGoal()) return;
      this.patrolGoal();
    }

    expandGoal() {
      var p = this.p;
      var g = this.game.grid;
      for (var tries = 0; tries < 22; tries++) {
        var ang = this.game.rng() * Math.PI * 2;
        var dist = 5 + this.game.rng() * this.cfg.goalDist;
        var tx = Math.round(p.cx + Math.cos(ang) * dist);
        var ty = Math.round(p.cy + Math.sin(ang) * dist);
        tx = C.clamp(tx, 2, g.w - 3);
        ty = C.clamp(ty, 2, g.h - 3);
        if (g.ownerAt(tx, ty) === p.id) continue;
        if (g.hasTrailAt(tx, ty, p.id)) continue;
        if (g.isWall(tx, ty)) continue;
        this.goal = { x: tx, y: ty };
        this.goalTime = this.cfg.patience;
        this.state = 'EXPAND';
        return true;
      }
      return false;
    }

    patrolGoal() {
      var p = this.p, g = this.game.grid;
      var found = null;
      for (var r = 3; r <= 14 && !found; r++) {
        var a = this.game.rng() * Math.PI * 2;
        var x = Math.round(p.cx + Math.cos(a) * r);
        var y = Math.round(p.cy + Math.sin(a) * r);
        if (g.ownerAt(x, y) === p.id) found = { x: x, y: y };
      }
      this.goal = found || { x: p.cx, y: p.cy };
      this.goalTime = 1.8;
      this.state = 'PATROL';
    }

    goHome(state) {
      var p = this.p, g = this.game.grid;
      var best = null, bestD = Infinity;
      for (var r = 1; r <= 26 && !best; r++) {
        for (var dx = -r; dx <= r; dx++) {
          for (var dy = -r; dy <= r; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            var x = p.cx + dx, y = p.cy + dy;
            if (!g.inBounds(x, y)) continue;
            if (g.ownerAt(x, y) !== p.id) continue;
            var d = Math.abs(dx) + Math.abs(dy);
            if (d < bestD) { bestD = d; best = { x: x, y: y }; }
          }
        }
      }
      this.goal = best || { x: Math.round(g.w / 2), y: Math.round(g.h / 2) };
      this.goalTime = 3.2;
      this.state = state || 'RETURN';
    }

    /* ---------------- восприятие ---------------- */

    findEnemyTrail() {
      var p = this.p, best = null, bestD = Infinity;
      var players = this.game.players;
      for (var i = 0; i < players.length; i++) {
        var q = players[i];
        if (!q.alive || q.id === p.id || !q.trailPath.length) continue;
        var step = Math.max(1, Math.floor(q.trailPath.length / 24));
        for (var k = 0; k < q.trailPath.length; k += step) {
          var pt = q.trailPath[k];
          var d = Math.abs(pt.x - p.cx) + Math.abs(pt.y - p.cy);
          if (d <= this.cfg.vision && d < bestD) {
            bestD = d;
            best = { x: Math.floor(pt.x), y: Math.floor(pt.y) };
          }
        }
      }
      return best;
    }

    enemyNearTrail(radius) {
      var p = this.p;
      var path = p.trailPath;
      if (!path.length) return false;
      var step = Math.max(1, Math.floor(path.length / 32));
      var players = this.game.players;
      for (var i = 0; i < players.length; i++) {
        var q = players[i];
        if (!q.alive || q.id === p.id) continue;
        for (var k = 0; k < path.length; k += step) {
          if (Math.abs(q.cx - path[k].x) + Math.abs(q.cy - path[k].y) <= radius) return true;
        }
        if (Math.abs(q.cx - p.cx) + Math.abs(q.cy - p.cy) < 3) return true;
      }
      return false;
    }

    enemyOnMyLand() {
      var p = this.p, g = this.game.grid;
      var players = this.game.players;
      for (var i = 0; i < players.length; i++) {
        var q = players[i];
        if (!q.alive || q.id === p.id) continue;
        if (g.ownerAt(q.cx, q.cy) === p.id) return q;
      }
      return null;
    }

    /* ---------------- выбор направления ---------------- */

    chooseDir() {
      var p = this.p;
      var best = null, bestScore = -Infinity;
      for (var i = 0; i < DIRS.length; i++) {
        var d = DIRS[i];
        if (p.trailing && d.x === -p.dir.x && d.y === -p.dir.y) continue; // разворот запрещён
        var s = this.scoreDir(d);
        if (s > bestScore) { bestScore = s; best = d; }
      }
      return best;
    }

    scoreDir(d) {
      var p = this.p, g = this.game.grid;
      var own = bitOf(p.id);
      var nx = p.cx + d.x, ny = p.cy + d.y;
      if (!g.inBounds(nx, ny) || g.isWall(nx, ny)) return -1e6;
      var nextBits = g.trailAt(nx, ny);
      if (nextBits & own) return -1e6;                 // свой след = смерть
      var nextOwned = g.ownerAt(nx, ny) === p.id;

      // «взлётная полоса»: сколько клеток впереди до препятствия
      var runway = 0, enemyAround = 0;
      var x = nx, y = ny;
      for (var k = 0; k < 12; k++) {
        if (!g.inBounds(x, y) || g.isWall(x, y)) break;
        var b = g.trailAt(x, y);
        if (b & own) break;
        if (b) { runway += 2; break; }
        runway++;
        x += d.x; y += d.y;
      }
      // вражеские следы вокруг — возможность убить
      for (var e = 0; e < this.game.players.length; e++) {
        var q = this.game.players[e];
        if (!q.alive || q.id === p.id) continue;
        if (g.hasTrailAt(nx, ny, q.id)) enemyAround = 1;
      }

      var score = Math.min(runway, 12) * 2.2;
      if (enemyAround) score += 58;                     // пересечение чужого следа
      if (nextOwned) score += p.trailing ? 26 + Math.min(p.trailCells.size, 24) * 0.8 : 5;

      if (this.goal) {
        var cd = Math.abs(this.goal.x - p.cx) + Math.abs(this.goal.y - p.cy);
        var nd = Math.abs(this.goal.x - nx) + Math.abs(this.goal.y - ny);
        score += (cd - nd) * 7;
      }

      // не подставляться под лобовое столкновение
      for (var f = 0; f < this.game.players.length; f++) {
        var r = this.game.players[f];
        if (!r.alive || r.id === p.id) continue;
        var dq = Math.abs(r.cx - nx) + Math.abs(r.cy - ny);
        if (dq === 0) score -= 140;
        else if (dq === 1 && r.dir.x === -d.x && r.dir.y === -d.y) score -= 55;
        else if (dq <= 2) score -= 7;
      }

      // близость к краю карты
      if (!nextOwned && (nx < 3 || ny < 3 || nx >= g.w - 3 || ny >= g.h - 3)) {
        score -= this.cfg.edgeFear;
      }
      if (d === p.dir) score += 3.5;                    // инерция против дёрганья
      score += this.game.rng() * 1.4;
      return score;
    }
  }

  return { AI: { BotBrain: BotBrain, LEVELS: LEVELS } };
});
