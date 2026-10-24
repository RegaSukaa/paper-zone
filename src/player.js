/* ============================================================================
 * player.js — сущность игрока: непрерывные координаты и учёт следа.
 * Никакой отрисовки и игровых правил здесь нет: только состояние.
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

  var PHYS = C.PHYS;
  var STAMP_MEMORY = 26; // сколько последних штампов считаются «хвостом под головой»

  class Player {
    constructor(id, o) {
      this.id = id;
      this.isBot = !!o.isBot;
      this.name = o.name || (o.isBot ? 'Бот ' + id : 'Игрок');
      this.alive = true;
      this.skinId = o.skinId || 'mint';
      this.palette = o.palette || null;

      // непрерывное положение в клетках мира
      this.x = o.x;
      this.y = o.y;
      this.angle = o.angle !== undefined ? o.angle : 0;
      this.wantAngle = this.angle;
      this.speed = o.speed || PHYS.speed;
      this.radius = PHYS.headRadius;

      // след
      this.trailing = false;
      this.px = this.x;
      this.py = this.y;
      this.trail = new Set();
      this.trailPath = [];
      this.stamps = [];
      this.recent = new Set();

      this.kills = 0;
      this.deathAt = 0;
      this.deathCause = null;
      this.bot = null;
      this.brainState = 'IDLE';
      this.capturedTotal = 0;
      this.spawnAt = 0;
      this.bob = Math.random() * Math.PI * 2;
    }

    get cx() { return Math.floor(this.x); }
    get cy() { return Math.floor(this.y); }

    trailLength() { return this.trail.size; }

    isRecent(idx) { return this.recent.has(idx); }

    beginTrail() {
      this.trailing = true;
      this.trail.clear();
      this.trailPath.length = 0;
      this.stamps.length = 0;
      this.recent.clear();
    }

    /* Запомнить штамп клеток: последние STAMP_MEMORY не считаются
     * препятствием для собственной головы (это «хвост» под ней). */
    pushStamp(cells, gridWidth) {
      // «зона прощения» шире самого следа: голова может пройти вплотную к
      // своей линии, и это не должно убивать. Смерть — только реальный въезд
      // в след, оставленный заметно раньше.
      var arr = [];
      var w = gridWidth || 0;
      for (var i = 0; i < cells.length; i++) {
        var idx = cells[i];
        arr.push(idx);
        if (!w) continue;
        if (idx % w > 0) arr.push(idx - 1);
        if (idx % w < w - 1) arr.push(idx + 1);
        arr.push(idx - w);
        arr.push(idx + w);
      }
      this.stamps.push(arr);
      for (var a = 0; a < arr.length; a++) this.recent.add(arr[a]);
      while (this.stamps.length > STAMP_MEMORY) {
        var old = this.stamps.shift();
        for (var k = 0; k < old.length; k++) {
          var cell = old[k];
          if (!this.containsInStamps(cell)) this.recent.delete(cell);
        }
      }
    }

    containsInStamps(idx) {
      for (var i = 0; i < this.stamps.length; i++) {
        for (var k = 0; k < this.stamps[i].length; k++) {
          if (this.stamps[i][k] === idx) return true;
        }
      }
      return false;
    }

    clearTrail() {
      this.trailing = false;
      this.px = this.x;
      this.py = this.y;
      this.trail.clear();
      this.trailPath.length = 0;
      this.stamps.length = 0;
      this.recent.clear();
    }
  }

  return { Player: Player, STAMP_MEMORY: STAMP_MEMORY };
});
