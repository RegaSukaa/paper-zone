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

  /* Палитры персонажей переехали в src/skins.js. */

  function bitOf(id) { return 1 << (id - 1); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* Физика движения: непрерывные координаты в клетках мира. */
  var PHYS = {
    speed: 13.5,        // клеток в секунду
    turnRate: 8.2,      // рад/с — ограничение угловой скорости
    headRadius: 1.05,   // радиус головы (визуал + столкновения)
    trailRadius: 1.15,  // радиус штампа: головa не может задеть незаштампованную клетку
    substep: 0.34,      // максимум клеток за один подшаг
    grace: 16,          // сколько последних штампов не считаются «своим следом»
    deadzone: 1.6       // радиус вокруг головы, внутри которого курсор не меняет курс
  };

  var TAU = Math.PI * 2;

  function angNorm(a) {
    a = a % TAU;
    if (a < -Math.PI) a += TAU;
    if (a > Math.PI) a -= TAU;
    return a;
  }
  function angleTo(x0, y0, x1, y1) { return Math.atan2(y1 - y0, x1 - x0); }
  function turnToward(cur, want, maxStep) {
    var d = angNorm(want - cur);
    if (Math.abs(d) <= maxStep) return want;
    return cur + Math.sign(d) * maxStep;
  }
  function dist2(x0, y0, x1, y1) {
    var dx = x1 - x0, dy = y1 - y0;
    return dx * dx + dy * dy;
  }

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

    /* Штамп круглого следа: клетки, чьи центры попали в радиус. Возвращает
     * количество новых клеток и заполняет out (массив индексов). */
    stampDisc(cx, cy, r, id, out) {
      var x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
      var y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
      var added = 0;
      out.length = 0;
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          if (!this.inBounds(x, y)) continue;
          var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (dx * dx + dy * dy > r * r) continue;
          var i = y * this.w + x;
          out.push(i);
          if (this.addTrailIdx(i, id)) added++;
        }
      }
      return added;
    }

    /* Тонкий след по отрезку: клетки, через которые реально прошла голова.
     * Шаг выборки 0.4 клетки гарантирует 4-связность без «толстых» пятен. */
    stampLine(x0, y0, x1, y1, id, out) {
      out.length = 0;
      var dx = x1 - x0, dy = y1 - y0;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var steps = Math.max(1, Math.ceil(dist / 0.4));
      var added = 0;
      var prevX = null, prevY = null;
      for (var k = 0; k <= steps; k++) {
        var t = k / steps;
        var x = Math.floor(x0 + dx * t), y = Math.floor(y0 + dy * t);
        if (prevX !== null && x !== prevX && y !== prevY) {
          // диагональный переход: добавляем «угол», иначе след не 4-связный
          var ex = prevX, ey = y;
          if (this.inBounds(ex, ey)) {
            var ei = ey * this.w + ex;
            if (out.indexOf(ei) === -1) { out.push(ei); if (this.addTrailIdx(ei, id)) added++; }
          }
        }
        prevX = x;
        prevY = y;
        if (!this.inBounds(x, y)) continue;
        var i = y * this.w + x;
        if (out.indexOf(i) !== -1) continue;
        out.push(i);
        if (this.addTrailIdx(i, id)) added++;
      }
      return added;
    }

    /* Клетки круга без изменения состояния — для проверок столкновений. */
    discCells(cx, cy, r, out) {
      var x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
      var y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
      out.length = 0;
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          if (!this.inBounds(x, y)) continue;
          var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (dx * dx + dy * dy > r * r) continue;
          out.push(y * this.w + x);
        }
      }
      return out;
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
    PHYS: PHYS,
    TAU: TAU,
    angNorm: angNorm,
    angleTo: angleTo,
    turnToward: turnToward,
    dist2: dist2,
    Grid: Grid,
    bitOf: bitOf,
    clamp: clamp,
    mulberry32: mulberry32,
    hexToRgb: hexToRgb
  };
});
