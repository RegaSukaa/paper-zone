/* ============================================================================
 * ai.js — боты для непрерывного движения.
 *
 * Бот видит только то, что видно игроку: владельцев клеток, следы и головы.
 * Решение — это целевой угол: 24 направления оцениваются трассировкой луча
 * (свободный ход, свой след, чужой след, своя земля) плюс притяжение к цели.
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

  var bitOf = C.bitOf;
  var angNorm = C.angNorm;
  var TAU = C.TAU;
  var clamp = C.clamp;

  var LEVELS = {
    easy: { risk: 30, aggression: 0.06, vision: 14, interval: 0.16, speed: 0.90,
            goalDist: 16, patience: 3.2, edgeFear: 26, attackTrailRatio: 0.35 },
    medium: { risk: 52, aggression: 0.22, vision: 20, interval: 0.10, speed: 1.00,
              goalDist: 26, patience: 2.4, edgeFear: 20, attackTrailRatio: 0.5 },
    hard: { risk: 85, aggression: 0.48, vision: 28, interval: 0.06, speed: 1.06,
            goalDist: 36, patience: 1.8, edgeFear: 15, attackTrailRatio: 0.7 }
  };

  var HEADINGS = 24;

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
      this.stuck = 0;
      this.lastX = player.x;
      this.lastY = player.y;
    }

    think(dt) {
      var p = this.p;
      if (!p.alive) return;
      this.timer -= dt;
      this.goalTime -= dt;

      var moved = C.dist2(p.x, p.y, this.lastX, this.lastY);
      this.stuck = moved < 0.02 ? this.stuck + dt : 0;
      this.lastX = p.x;
      this.lastY = p.y;

      if (this.timer > 0) return;
      this.timer = this.cfg.interval;

      if (!this.goal || this.goalTime <= 0 || this.reachedGoal() || this.stuck > 0.7) {
        this.pickGoal();
        this.stuck = 0;
      }
      this.steer();
    }

    reachedGoal() {
      if (!this.goal) return true;
      // радиус приёма цели должен быть больше радиуса разворота, иначе бот
      // начинает нарезать круги вокруг недостижимой точки
      var limit = this.p.trail.size > 0 ? 7 : 4;
      return C.dist2(this.goal.x, this.goal.y, this.p.x, this.p.y) < limit * limit;
    }

    /* --------------------------- выбор цели ---------------------------- */

    pickGoal() {
      var p = this.p;
      var trail = p.trail.size;

      if (trail > 6 && this.enemyNearTrail(this.cfg.vision * 0.55)) {
        this.goHome('EVADE');
        return;
      }
      if (trail > this.cfg.risk * 0.62 && this.enemyNearTrail(this.cfg.vision)) {
        this.goHome('EVADE');
        return;
      }
      if (trail > this.cfg.risk) {
        this.goHome('RETURN');
        return;
      }
      if (trail < this.cfg.risk * this.cfg.attackTrailRatio && this.game.rng() < this.cfg.aggression + 0.05) {
        var target = this.findEnemyTrail();
        if (target) {
          this.goal = target;
          this.goalTime = 2.4;
          this.state = 'ATTACK';
          return;
        }
      }
      var intruder = this.enemyOnMyLand();
      if (intruder && trail < 20) {
        this.goal = {
          x: clamp(intruder.x + Math.cos(intruder.angle) * 7, 6, this.game.grid.w - 6),
          y: clamp(intruder.y + Math.sin(intruder.angle) * 7, 6, this.game.grid.h - 6)
        };
        this.goalTime = 2;
        this.state = 'DEFEND';
        return;
      }
      // держим прежнюю цель, только пока до неё реально далеко: иначе бот
      // нарезает вокруг неё круги и врезается в собственный след
      if (trail > 0 && this.goal && !this.reachedGoal()) {
        this.goalTime = Math.max(this.goalTime, this.cfg.patience * 0.6);
        this.state = 'EXPAND';
        return;
      }
      if (this.expandGoal()) return;
      this.patrolGoal();
    }

    expandGoal() {
      var p = this.p, g = this.game.grid;
      for (var tries = 0; tries < 26; tries++) {
        var ang = this.game.rng() * TAU;
        var dist = (p.trail.size > 0 ? 18 : 8) + this.game.rng() * this.cfg.goalDist;
        var tx = clamp(p.x + Math.cos(ang) * dist, 8, g.w - 8);
        var ty = clamp(p.y + Math.sin(ang) * dist, 8, g.h - 8);
        if (g.ownerAt(Math.floor(tx), Math.floor(ty)) === p.id) continue;
        if (this.crowded(tx, ty)) continue;
        if (this.lineBlocked(tx, ty)) continue;
        this.goal = { x: tx, y: ty };
        this.goalTime = this.cfg.patience;
        this.state = 'EXPAND';
        return true;
      }
      return false;
    }

    patrolGoal() {
      var p = this.p, g = this.game.grid;
      var ang = this.game.rng() * TAU;
      this.goal = {
        x: clamp(p.x + Math.cos(ang) * 10, 4, g.w - 4),
        y: clamp(p.y + Math.sin(ang) * 10, 4, g.h - 4)
      };
      this.goalTime = 1.6;
      this.state = 'PATROL';
    }

    /* Возврат домой по собственному следу: идём не «по прямой к земле», а
     * вдоль следа, отступив наружу. Прямая дорога часто перекрыта своим же
     * хвостом, и жадный курс заводит бота в спираль. */
    goHome(state) {
      var p = this.p, path = p.trailPath;
      if (path.length > 12) {
        var back = Math.min(path.length - 2, 34);
        var idx = path.length - 1 - back;
        var pt = path[idx];
        var prev = path[Math.max(0, idx - 2)];
        var dx = pt.x - prev.x, dy = pt.y - prev.y;
        var len = Math.hypot(dx, dy) || 1;
        var nx = -dy / len, ny = dx / len;
        var sideA = this.clearance(pt.x + nx * 3.6, pt.y + ny * 3.6);
        var sideB = this.clearance(pt.x - nx * 3.6, pt.y - ny * 3.6);
        var sign = sideA >= sideB ? 1 : -1;
        this.goal = { x: pt.x + nx * 3.6 * sign, y: pt.y + ny * 3.6 * sign };
        this.goalTime = 1.1;
        this.state = state || 'RETURN';
        return;
      }
      var g = this.game.grid;
      var cx = Math.floor(p.x), cy = Math.floor(p.y);
      var best = null, bestD = Infinity;
      for (var r = 1; r <= 34 && !best; r++) {
        for (var ddx = -r; ddx <= r; ddx++) {
          for (var ddy = -r; ddy <= r; ddy++) {
            if (Math.max(Math.abs(ddx), Math.abs(ddy)) !== r) continue;
            var x = cx + ddx, y = cy + ddy;
            if (!g.inBounds(x, y)) continue;
            if (g.ownerAt(x, y) !== p.id) continue;
            var d = ddx * ddx + ddy * ddy;
            if (d < bestD) { bestD = d; best = { x: x + 0.5, y: y + 0.5 }; }
          }
        }
      }
      this.goal = best || { x: g.w / 2, y: g.h / 2 };
      this.goalTime = 3;
      this.state = state || 'RETURN';
    }

    /* Прямая до цели не должна пересекать свой же след: иначе бот идёт
     * напролом через собственную линию и погибает. */
    lineBlocked(tx, ty) {
      var g = this.game.grid, p = this.p;
      var dx = tx - p.x, dy = ty - p.y;
      var dist = Math.hypot(dx, dy);
      var steps = Math.max(1, Math.ceil(dist / 1.2));
      var own = bitOf(p.id);
      for (var k = 1; k < steps; k++) {
        var x = Math.floor(p.x + dx * (k / steps));
        var y = Math.floor(p.y + dy * (k / steps));
        if (!g.inBounds(x, y)) return true;
        var idx = y * g.w + x;
        if ((g.trail[idx] & own) && !p.recent.has(idx)) return true;
      }
      return false;
    }

    /* Рядом с чужой головой лучше не начинать маршрут: там пересекут след. */
    crowded(x, y) {
      for (var i = 0; i < this.game.players.length; i++) {
        var q = this.game.players[i];
        if (!q.alive || q.id === this.p.id) continue;
        if (C.dist2(q.x, q.y, x, y) < 18 * 18) return true;
      }
      return false;
    }

    /* Сколько свободного места вокруг точки (для выбора стороны обхода). */
    clearance(x, y) {
      var g = this.game.grid, n = 0;
      for (var dy = -3; dy <= 3; dy++) {
        for (var dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy > 10) continue;
          var cx = Math.floor(x + dx), cy = Math.floor(y + dy);
          if (!g.inBounds(cx, cy)) continue;
          if (g.trailAt(cx, cy)) continue;
          if (g.ownerAt(cx, cy) === this.p.id) continue;
          n++;
        }
      }
      return n;
    }

    /* ----------------------------- восприятие --------------------------- */

    findEnemyTrail() {
      var p = this.p, best = null, bestD = Infinity;
      var vision2 = this.cfg.vision * this.cfg.vision;
      for (var i = 0; i < this.game.players.length; i++) {
        var q = this.game.players[i];
        if (!q.alive || q.id === p.id) continue;
        var path = q.trailPath;
        if (!path.length) continue;
        var step = Math.max(1, Math.floor(path.length / 28));
        for (var k = 0; k < path.length; k += step) {
          var d = C.dist2(path[k].x, path[k].y, p.x, p.y);
          if (d < vision2 && d < bestD) { bestD = d; best = { x: path[k].x, y: path[k].y }; }
        }
      }
      return best;
    }

    enemyNearTrail(radius) {
      var p = this.p;
      var r2 = radius * radius;
      var path = p.trailPath;
      var step = Math.max(1, Math.floor(path.length / 26) || 1);
      for (var i = 0; i < this.game.players.length; i++) {
        var q = this.game.players[i];
        if (!q.alive || q.id === p.id) continue;
        for (var k = 0; k < path.length; k += step) {
          if (C.dist2(q.x, q.y, path[k].x, path[k].y) < r2) return true;
        }
        if (C.dist2(q.x, q.y, p.x, p.y) < 30) return true;
      }
      return false;
    }

    enemyOnMyLand() {
      var p = this.p, g = this.game.grid;
      for (var i = 0; i < this.game.players.length; i++) {
        var q = this.game.players[i];
        if (!q.alive || q.id === p.id) continue;
        if (g.ownerAt(Math.floor(q.x), Math.floor(q.y)) === p.id) return q;
      }
      return null;
    }

    /* --------------------------- оценка курса --------------------------- */

    /* Выбираем лучший курс, но при близких оценках — тот, что ближе к текущему:
     * иначе бот дёргается между двумя «одинаково хорошими» вариантами и
     * выписывает зигзаг, в который сам же и врезается. */
    steer() {
      var p = this.p;
      var goalAngle = this.goal ? Math.atan2(this.goal.y - p.y, this.goal.x - p.x) : p.angle;
      var returning = this.state === 'RETURN' || this.state === 'EVADE';
      var scores = new Array(HEADINGS);
      var maxScore = -Infinity;
      for (var i = 0; i < HEADINGS; i++) {
        var a = (i / HEADINGS) * TAU;
        scores[i] = this.scoreHeading(a, goalAngle, returning);
        if (scores[i] > maxScore) maxScore = scores[i];
      }
      var best = p.angle, bestTurn = Infinity;
      for (var k = 0; k < HEADINGS; k++) {
        if (scores[k] < maxScore - 3) continue;
        var a2 = (k / HEADINGS) * TAU;
        var turn = Math.abs(angNorm(a2 - p.angle));
        if (turn < bestTurn) { bestTurn = turn; best = a2; }
      }
      p.wantAngle = best;
    }

    /* Свободный коридор по курсу: минимум из трёх лучей (сам курс и «плечи»),
     * иначе бот видит только ось и цепляет свой след на повороте. */
    scan(a, own, out) {
      var p = this.p, g = this.game.grid;
      var cos = Math.cos(a), sin = Math.sin(a);
      var stepLen = 1.5;
      var free = 0;
      out.kill = false;
      out.home = false;
      out.blocked = false;
      for (var k = 1; k <= 22; k++) {
        var x = p.x + cos * stepLen * k;
        var y = p.y + sin * stepLen * k;
        if (x < 5 || y < 5 || x > g.w - 5 || y > g.h - 5) { out.blocked = true; break; }
        var cx = Math.floor(x), cy = Math.floor(y);
        var bits = g.trailAt(cx, cy);
        if (bits & own) {
          var idx = cy * g.w + cx;
          if (!p.recent.has(idx)) { out.blocked = true; break; }
        }
        if (bits & ~own) { out.kill = true; free += 2; break; }
        if (g.ownerAt(cx, cy) === p.id) { out.home = true; free += 1; break; }
        free += 1;
      }
      return free;
    }

    scoreHeading(a, goalAngle, returning) {
      var p = this.p, g = this.game.grid;
      var own = bitOf(p.id);
      var probe = { kill: false, home: false, blocked: false };
      var sideA = { kill: false, home: false, blocked: false };
      var sideB = { kill: false, home: false, blocked: false };
      var main = this.scan(a, own, probe);
      var sideL = this.scan(a + 0.28, own, sideA);
      var sideR = this.scan(a - 0.28, own, sideB);
      var free = main;
      var kill = probe.kill;
      var home = probe.home;
      var blocked = probe.blocked;

      var score = free * 1.35 + Math.min(sideL, sideR, free) * 0.45;
      if (blocked) score -= 90;
      if (free < 3) score -= 18;
      // «плечи» упираются в свой след — курс ведёт впритирку к хвосту
      if ((sideA.blocked || sideB.blocked) && this.p.trail.size > 0) score -= 26;
      if (kill) score += 13;
      if (home) score += returning ? 34 : 5;

      // притяжение к цели
      var diff = Math.abs(angNorm(a - goalAngle));
      score += Math.cos(diff) * (returning ? 30 : 24);

      // плавность: не дёргаться
      score -= Math.abs(angNorm(a - p.angle)) * (blocked ? 1.2 : 4.6);

      // край карты
      if (!home) {
        var edgeDist = Math.min(p.x, p.y, g.w - p.x, g.h - p.y);
        if (edgeDist < 12) score -= this.cfg.edgeFear * (1 - edgeDist / 12) * (0.5 + 0.5 * Math.cos(diff));
      }
      score += this.game.rng() * 0.35;
      return score;
    }
  }

  return { AI: { BotBrain: BotBrain, LEVELS: LEVELS } };
});
