/* ============================================================================
 * core.js — игровая сетка, следы и алгоритм захвата территории.
 * Файл не зависит от DOM: тот же код грузится в браузере (window.PIO) и в Node
 * (module.exports), поэтому правила проверяются автотестами без браузера.
 * ==========================================================================*/
(function (root, factory) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var api = factory();
  root.PIO = root.PIO || {};
  Object.assign(root.PIO, api);
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_PLAYERS = 8;

  /* Четыре направления. Объекты общие (=== сравнение по ссылке). */
  var DIRS = [
    { x: 1, y: 0, name: 'right' },
    { x: 0, y: 1, name: 'down' },
    { x: -1, y: 0, name: 'left' },
    { x: 0, y: -1, name: 'up' }
  ];

  var SKINS = [
    { name: 'Мята',    land: '#17b98a', edge: '#5cf3c6', trail: '#3ceec0', head: '#c6ffef' },
    { name: 'Индиго',  land: '#3a74f0', edge: '#8db2ff', trail: '#5f9bff', head: '#d6e4ff' },
    { name: 'Аметист', land: '#9553ef', edge: '#c9a3ff', trail: '#b487ff', head: '#e9d9ff' },
    { name: 'Манго',   land: '#e8841a', edge: '#ffc176', trail: '#ffa63c', head: '#ffe3bc' },
    { name: 'Фуксия',  land: '#e3439a', edge: '#ff9dcc', trail: '#ff69b4', head: '#ffd7ea' },
    { name: 'Лайм',    land: '#b9c318', edge: '#e9f35f', trail: '#ddeb3a', head: '#f8ffb4' },
    { name: 'Коралл',  land: '#e04338', edge: '#ff9a92', trail: '#ff6f63', head: '#ffd2cd' },
    { name: 'Аква',    land: '#0f9fbf', edge: '#66dcf0', trail: '#28c6e8', head: '#c3f3ff' }
  ];

  function bitOf(id) { return 1 << (id - 1); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* Детерминированный ГПСЧ — матчи воспроизводимы по seed. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hexToRgb(hex) {
    var v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  /* ==========================================================================
   * Grid — дискретное поле. Одна клетка = одна единица мира.
   * owner: 0 нейтрально, 1..N — владелец.
   * trail: битовая маска (до 16 игроков), следы разных игроков могут лежать
   *        в одной клетке одновременно.
   * wall:  недоступные клетки (входят в исключения из площади).
   * ========================================================================*/
  class Grid {
    constructor(w, h, maxPlayers) {
      this.w = Math.max(4, w | 0);
      this.h = Math.max(4, h | 0);
      this.size = this.w * this.h;
      this.maxPlayers = maxPlayers || MAX_PLAYERS;
      this.owner = new Uint8Array(this.size);
      this.trail = new Uint16Array(this.size);
      this.wall = new Uint8Array(this.size);
      this.counts = new Int32Array(this.maxPlayers + 2);
      this.wallCount = 0;
      this.trailSets = new Map();
      this.ownerRev = 0;
    }

    idx(x, y) { return y * this.w + x; }
    xOf(i) { return i % this.w; }
    yOf(i) { return (i / this.w) | 0; }
    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

    ownerAt(x, y) { return this.inBounds(x, y) ? this.owner[y * this.w + x] : -1; }
    trailAt(x, y) { return this.inBounds(x, y) ? this.trail[y * this.w + x] : 0; }
    isWall(x, y) { return !this.inBounds(x, y) || this.wall[y * this.w + x] === 1; }
    hasTrailAt(x, y, id) { return this.inBounds(x, y) && (this.trail[y * this.w + x] & bitOf(id)) !== 0; }
    hasTrailIdx(i, id) { return (this.trail[i] & bitOf(id)) !== 0; }

    setWall(x, y, blocked) {
      if (!this.inBounds(x, y)) return;
      var i = y * this.w + x;
      var v = blocked ? 1 : 0;
      if (this.wall[i] === v) return;
      this.wall[i] = v;
      this.wallCount += blocked ? 1 : -1;
      this.ownerRev++;
    }

    freeCells() { return this.size - this.wallCount; }
    ownerCount(id) { return this.counts[id] || 0; }
    percent(id) {
      var f = this.freeCells();
      return f > 0 ? (this.counts[id] || 0) / f * 100 : 0;
    }

    setOwnerIdx(i, id) {
      var prev = this.owner[i];
      if (prev === id) return;
      if (prev) this.counts[prev]--;
      if (id) this.counts[id]++;
      this.owner[i] = id;
      this.ownerRev++;
    }
    setOwnerAt(x, y, id) { if (this.inBounds(x, y)) this.setOwnerIdx(y * this.w + x, id); }

    /* Закрасить прямоугольник (стартовая зона игрока, тесты). */
    claimRect(x0, y0, w, h, id) {
      var n = 0;
      for (var y = y0; y < y0 + h; y++) {
        for (var x = x0; x < x0 + w; x++) {
          if (!this.inBounds(x, y)) continue;
          this.setOwnerIdx(y * this.w + x, id);
          n++;
        }
      }
      return n;
    }

    addTrailIdx(i, id) {
      var bit = bitOf(id);
      if (this.trail[i] & bit) return false;
      this.trail[i] |= bit;
      var s = this.trailSets.get(id);
      if (!s) { s = new Set(); this.trailSets.set(id, s); }
      s.add(i);
      return true;
    }
    addTrailAt(x, y, id) {
      if (!this.inBounds(x, y)) return false;
      return this.addTrailIdx(y * this.w + x, id);
    }
    removeTrailIdx(i, id) {
      var bit = bitOf(id);
      if (!(this.trail[i] & bit)) return false;
      this.trail[i] &= ~bit;
      var s = this.trailSets.get(id);
      if (s) s.delete(i);
      return true;
    }
    trailSet(id) {
      var s = this.trailSets.get(id);
      if (!s) { s = new Set(); this.trailSets.set(id, s); }
      return s;
    }
    trailLength(id) { var s = this.trailSets.get(id); return s ? s.size : 0; }
    clearTrail(id) {
      var s = this.trailSets.get(id);
      if (!s || s.size === 0) return;
      var bit = bitOf(id), inv = ~bit;
      s.forEach(function (i) { this.trail[i] &= inv; }, this);
      s.clear();
    }

    /* ---------------------------------------------------------------------
     * Захват: заливка «снаружи». Стенами считаются своя территория, свой след
     * и стены карты. Всё, что недостижимо от границы карты, — замкнутая
     * область, она переходит игроку. Так корректно работают любые контуры:
     * вогнутые, с самопересечениями, у края карты, вокруг чужой территории.
     * -------------------------------------------------------------------*/
    capture(id) {
      var w = this.w, h = this.h, size = this.size;
      var owner = this.owner, trail = this.trail, wall = this.wall;
      var bit = bitOf(id);
      var blocked = new Uint8Array(size);
      var i, x, y;
      for (i = 0; i < size; i++) {
        blocked[i] = (wall[i] || owner[i] === id || (trail[i] & bit)) ? 1 : 0;
      }
      var seen = new Uint8Array(size);
      var queue = new Int32Array(size);
      var qh = 0, qt = 0;
      function seed(j) {
        if (!blocked[j] && !seen[j]) { seen[j] = 1; queue[qt++] = j; }
      }
      for (x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
      for (y = 1; y < h - 1; y++) { seed(y * w); seed(y * w + w - 1); }

      while (qh < qt) {
        i = queue[qh++];
        x = i % w;
        if (x > 0) { var jl = i - 1; if (!blocked[jl] && !seen[jl]) { seen[jl] = 1; queue[qt++] = jl; } }
        if (x < w - 1) { var jr = i + 1; if (!blocked[jr] && !seen[jr]) { seen[jr] = 1; queue[qt++] = jr; } }
        if (i >= w) { var ju = i - w; if (!blocked[ju] && !seen[ju]) { seen[ju] = 1; queue[qt++] = ju; } }
        if (i < size - w) { var jd = i + w; if (!blocked[jd] && !seen[jd]) { seen[jd] = 1; queue[qt++] = jd; } }
      }

      var captured = [];
      for (i = 0; i < size; i++) {
        if (!seen[i] && !blocked[i]) captured.push(i);
      }
      for (var k = 0; k < captured.length; k++) this.setOwnerIdx(captured[k], id);
      return captured;
    }

    /* Замкнуть след: заливка + превращение клеток следа в территорию. */
    closeTrail(id) {
      var set = this.trailSets.get(id);
      var trailIdx = set ? Array.from(set) : [];
      var enclosed = this.capture(id);
      var bit = bitOf(id), inv = ~bit;
      for (var k = 0; k < trailIdx.length; k++) {
        var i = trailIdx[k];
        this.trail[i] &= inv;
        this.setOwnerIdx(i, id);
      }
      if (set) set.clear();
      return { enclosed: enclosed, trail: trailIdx, capturedCount: enclosed.length + trailIdx.length };
    }

    /* Полный сброс территории игрока в нейтраль (смерть). */
    releaseTerritory(id) {
      var n = 0;
      for (var i = 0; i < this.size; i++) {
        if (this.owner[i] === id) { this.setOwnerIdx(i, 0); n++; }
      }
      this.clearTrail(id);
      return n;
    }
  }

  return {
    MAX_PLAYERS: MAX_PLAYERS,
    DIRS: DIRS,
    SKINS: SKINS,
    Grid: Grid,
    bitOf: bitOf,
    clamp: clamp,
    mulberry32: mulberry32,
    hexToRgb: hexToRgb
  };
});
