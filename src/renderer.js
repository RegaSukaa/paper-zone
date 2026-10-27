/* ============================================================================
 * renderer.js — отрисовка мира: «бумажная» арена, территории, следы, персонажи.
 *
 * Территория хранится закадровым растром (1 клетка = 1 пиксель) и
 * пересобирается только при изменении владельцев. Персонажи рисуются
 * процедурными скинами из skins.js. Тени, свечения и частицы ограничены.
 * ==========================================================================*/
(function (root) {
  'use strict';

  var PIO = root.PIO;
  var clamp = PIO.clamp;
  var TAU = Math.PI * 2;

  /* Chaikin: срезает углы замкнутого контура — «лесенка» из клеток
   * превращается в плавную кривую. */
  function chaikin(pts) {
    var n = pts.length / 2;
    var out = new Array(n * 4);
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      var x0 = pts[i * 2], y0 = pts[i * 2 + 1], x1 = pts[j * 2], y1 = pts[j * 2 + 1];
      out[i * 4] = x0 * 0.75 + x1 * 0.25;
      out[i * 4 + 1] = y0 * 0.75 + y1 * 0.25;
      out[i * 4 + 2] = x0 * 0.25 + x1 * 0.75;
      out[i * 4 + 3] = y0 * 0.25 + y1 * 0.75;
    }
    return out;
  }

  /* Релаксация: каждая точка тянется к середине соседей. Убирает «лесенку»
   * в масштабе нескольких клеток — край становится волнистым, бумажным. */
  function relaxLoop(pts, passes, lambda) {
    var n = pts.length / 2;
    if (n < 6) return pts;
    var cur = pts;
    for (var it = 0; it < passes; it++) {
      var out = new Array(cur.length);
      for (var i = 0; i < n; i++) {
        var im = (i - 1 + n) % n, ip = (i + 1) % n;
        var ax = (cur[im * 2] + cur[ip * 2]) * 0.5;
        var ay = (cur[im * 2 + 1] + cur[ip * 2 + 1]) * 0.5;
        out[i * 2] = cur[i * 2] + lambda * (ax - cur[i * 2]);
        out[i * 2 + 1] = cur[i * 2 + 1] + lambda * (ay - cur[i * 2 + 1]);
      }
      cur = out;
    }
    return cur;
  }

  function smoothLoop(pts, iters, minStep) {
    var p = pts;
    for (var i = 0; i < iters; i++) p = chaikin(p);
    if (!minStep) return p;
    var out = [p[0], p[1]];
    var lx = p[0], ly = p[1];
    for (var k = 2; k < p.length; k += 2) {
      var dx = p[k] - lx, dy = p[k + 1] - ly;
      if (dx * dx + dy * dy >= minStep * minStep) { out.push(p[k], p[k + 1]); lx = p[k]; ly = p[k + 1]; }
    }
    return out;
  }

  var rgbCache = {};
  function rgb(hex) {
    if (!rgbCache[hex]) rgbCache[hex] = PIO.hexToRgb(hex);
    return rgbCache[hex];
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.game = null;
      this.rev = -1;
      this.skinById = {};
      this.cam = { x: 0, y: 0, zoom: 16 };
      this.camTarget = { x: 0, y: 0 };
      this.effects = [];
      this.particles = [];
      this.shake = 0;
      this.time = 0;
      this.viewW = 1;
      this.viewH = 1;
      this.dpr = 1;
      this.minimapOn = true;
      this.opts = {};
      this.dotPattern = null;
      this.quality = 1;

      this.paths = new Map();      // id -> Path2D (гладкие контуры земли)
      this.patterns = {};          // skinId -> CanvasPattern
      this.dotPat = null;          // кэш узора арены
      this.arenaGrad = null;       // кэш градиента кромки
      this._mmDirty = true;
      this._mmLast = -1;
      this.minimapRect = null;

      this.mmCanvas = document.createElement('canvas');
      this.mmCanvas.width = this.mmCanvas.height = 256;
      this.mmCtx = this.mmCanvas.getContext('2d');

      this.resize();
      this.buildPattern();
    }

    resize() {
      var w = window.innerWidth, h = window.innerHeight;
      // на телефоне рисуем в 1.5x вместо 3x: разницы не видно, кадры дешевле
      var small = Math.min(w, h) < 620;
      this.dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
      this.canvas.width = Math.max(1, Math.round(w * this.dpr));
      this.canvas.height = Math.max(1, Math.round(h * this.dpr));
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.viewW = w;
      this.viewH = h;
      // на слабых/маленьких экранах меньше частиц и свечения
      this.quality = (small || w * h < 700000 || (navigator.hardwareConcurrency || 4) <= 4) ? 0.6 : 1;
    }

    buildPattern() {
      var c = document.createElement('canvas');
      c.width = c.height = 16;
      var g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(8, 8, 1.15, 0, TAU);
      g.fill();
      this.dotPattern = c;
    }

    setGame(game) {
      this.game = game;
      this.rev = -1;
      this.effects.length = 0;
      this.particles.length = 0;
      this.shake = 0;
      this.skinById = {};
      for (var i = 0; i < game.players.length; i++) {
        var p = game.players[i];
        this.skinById[p.id] = PIO.skinById(p.skinId);
      }
      var g = game.grid;
      this.paths.clear();
      this.patterns = {};
      this.dotPat = null;
      this.arenaGrad = null;
      var me = game.players[0];
      this.cam.x = this.camTarget.x = me ? me.x : g.w / 2;
      this.cam.y = this.camTarget.y = me ? me.y : g.h / 2;
      this.rebuild();
    }

    registerPlayer(p) {
      this.skinById[p.id] = PIO.skinById(p.skinId);
    }

    /* ------------------------- вектор территории ------------------------ */
    /* Границы земли — замкнутые контуры по клеткам, сглаженные Chaikin.
     * Пересчёт только при смене владельцев (ownerRev), не в кадре. */

    rebuild() {
      if (!this.game) return;
      var g = this.game.grid;
      var w = g.w, h = g.h, owner = g.owner, wall = g.wall;
      var byId = {};
      var x, y, i, id, arr, key;

      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          i = y * w + x;
          id = owner[i];
          if (!id || wall[i]) continue;
          arr = byId[id] || (byId[id] = []);
          if (y === 0 || owner[i - w] !== id) arr.push(x, y, x + 1, y);
          if (x === w - 1 || owner[i + 1] !== id) arr.push(x + 1, y, x + 1, y + 1);
          if (y === h - 1 || owner[i + w] !== id) arr.push(x + 1, y + 1, x, y + 1);
          if (x === 0 || owner[i - 1] !== id) arr.push(x, y + 1, x, y);
        }
      }

      this.paths.clear();
      for (key in byId) this.buildPath(+key, byId[key]);
      this.rev = g.ownerRev;
      this._mmDirty = true;
    }

    /* Сцепить рёбра в замкнутые контуры и превратить их в Path2D. */
    buildPath(id, edges) {
      var count = edges.length / 4;
      var starts = new Map();
      var e, k, list;
      for (e = 0; e < count; e++) {
        k = edges[e * 4] + ',' + edges[e * 4 + 1];
        list = starts.get(k);
        if (!list) { list = []; starts.set(k, list); }
        list.push(e);
      }
      var used = new Uint8Array(count);
      var path = new Path2D();
      var loops = 0;
      for (var st = 0; st < count; st++) {
        if (used[st]) continue;
        var pts = [];
        var cur = st;
        var guard = count + 2;
        while (cur !== -1 && !used[cur] && guard-- > 0) {
          used[cur] = 1;
          pts.push(edges[cur * 4], edges[cur * 4 + 1]);
          var cand = starts.get(edges[cur * 4 + 2] + ',' + edges[cur * 4 + 3]);
          var next = -1;
          if (cand) {
            for (var c = 0; c < cand.length; c++) {
              if (!used[cand[c]]) { next = cand[c]; break; }
            }
          }
          cur = next;
        }
        if (pts.length < 8) continue;
        // релаксация до сглаживания: точки ещё через клетку, поэтому
        // срезаются именно ступеньки в 1-2 клетки, а не микроколебания
        var sp = relaxLoop(pts, 6, 0.5);
        sp = smoothLoop(sp, 2, 0.5);
        path.moveTo(sp[0], sp[1]);
        for (var q = 2; q < sp.length; q += 2) path.lineTo(sp[q], sp[q + 1]);
        path.closePath();
        loops++;
      }
      if (loops) this.paths.set(id, path);
    }

    /* Тематический узор поверхности: плитка 32 px = 4 клетки мира. */
    patternFor(skin) {
      if (this.patterns[skin.id] !== undefined) return this.patterns[skin.id];
      var cv = document.createElement('canvas');
      cv.width = cv.height = 32;
      var g2 = cv.getContext('2d');
      g2.fillStyle = 'rgba(255,255,255,0.55)';
      g2.strokeStyle = 'rgba(255,255,255,0.5)';
      g2.lineCap = 'round';
      switch (skin.texture) {
        case 'dots':
          g2.beginPath(); g2.arc(8, 8, 2.1, 0, TAU); g2.arc(24, 24, 2.1, 0, TAU); g2.fill(); break;
        case 'stripes':
          g2.lineWidth = 3.4;
          g2.beginPath(); g2.moveTo(-8, 14); g2.lineTo(14, -8); g2.moveTo(10, 40); g2.lineTo(40, 10); g2.stroke(); break;
        case 'waves':
          g2.lineWidth = 2.8;
          g2.beginPath();
          g2.moveTo(-2, 10); g2.quadraticCurveTo(8, 1, 18, 10); g2.quadraticCurveTo(26, 18, 34, 10);
          g2.moveTo(-2, 26); g2.quadraticCurveTo(8, 17, 18, 26); g2.quadraticCurveTo(26, 34, 34, 26);
          g2.stroke(); break;
        case 'grid':
          g2.lineWidth = 2;
          g2.beginPath(); g2.moveTo(0, 16); g2.lineTo(32, 16); g2.moveTo(16, 0); g2.lineTo(16, 32); g2.stroke(); break;
        case 'facets':
          g2.lineWidth = 2.2;
          g2.beginPath(); g2.moveTo(16, 3); g2.lineTo(29, 16); g2.lineTo(16, 29); g2.lineTo(3, 16); g2.closePath(); g2.stroke(); break;
        case 'streaks':
          g2.lineWidth = 2.4;
          g2.beginPath(); g2.moveTo(2, 7); g2.lineTo(15, 7); g2.moveTo(17, 25); g2.lineTo(30, 25); g2.stroke(); break;
        default:
          g2.beginPath(); g2.arc(10, 10, 1.6, 0, TAU); g2.fill();
      }
      var pat = this.ctx.createPattern(cv, 'repeat');
      if (pat && pat.setTransform && typeof DOMMatrix !== 'undefined') {
        try { pat.setTransform(new DOMMatrix().scaleSelf(4 / 32)); } catch (err) { /* старый браузер */ }
      }
      this.patterns[skin.id] = pat;
      return pat;
    }

    /* ------------------------------- эффекты ---------------------------- */

    addCaptureEffect(ev) {
      this.captureCount = (this.captureCount || 0) + 1;
      var cells = (ev.enclosed || []).concat(ev.trail || []);
      if (cells.length > 900) {
        var step = Math.ceil(cells.length / 900);
        var trimmed = [];
        for (var i = 0; i < cells.length; i += step) trimmed.push(cells[i]);
        cells = trimmed;
      }
      if (cells.length) this.effects.push({ type: 'cells', cells: cells, t: 0.42, dur: 0.42 });
      this.effects.push({ type: 'ring', x: ev.x, y: ev.y, t: 0.5, dur: 0.5, color: '#ffffff', r: 3 });
      if (this.effects.length > 24) this.effects.splice(0, this.effects.length - 24);
    }

    addDeathEffect(x, y, color) {
      this.effects.push({ type: 'ring', x: x, y: y, t: 0.55, dur: 0.55, color: color, r: 6 });
      var n = Math.round(18 * this.quality);
      for (var i = 0; i < n; i++) {
        var a = Math.random() * TAU, sp = 4 + Math.random() * 11;
        this.particles.push({
          x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0.45 + Math.random() * 0.35, max: 0.8,
          size: 0.14 + Math.random() * 0.2, color: color
        });
      }
      if (this.particles.length > 220) this.particles.splice(0, this.particles.length - 220);
      this.shake = Math.min(1, this.shake + 0.4);
    }

    addSpawnEffect(x, y, color) {
      this.effects.push({ type: 'ring', x: x, y: y, t: 0.45, dur: 0.45, color: color, r: 4 });
    }

    /* ------------------------------- камера ----------------------------- */

    updateCamera(dt) {
      var g = this.game;
      if (!g) return;
      var me = g.players[0];
      var tx, ty;
      if (me && me.alive) {
        tx = me.x + Math.cos(me.angle) * 3.2;
        ty = me.y + Math.sin(me.angle) * 3.2;
      } else {
        tx = this.camTarget.x; ty = this.camTarget.y;
      }
      var visible = Math.min(this.viewW, this.viewH) < 620 ? 21 : 30;
      var targetZoom = Math.min(this.viewW, this.viewH) / visible;
      if (this.overview && g.grid.circle) {
        // режим обзора: вся арена в кадре (демо и отладка)
        this.cam.x = g.grid.circle.cx;
        this.cam.y = g.grid.circle.cy;
        this.camTarget.x = this.cam.x;
        this.camTarget.y = this.cam.y;
        this.cam.zoom = Math.min(this.viewW, this.viewH) / (g.grid.circle.r * 2.1);
        return;
      }
      this.cam.zoom += (targetZoom - this.cam.zoom) * Math.min(1, dt * 3.5);

      var hw = this.viewW / (2 * this.cam.zoom);
      var hh = this.viewH / (2 * this.cam.zoom);
      var gw = g.grid.w, gh = g.grid.h;
      tx = hw * 2 >= gw ? gw / 2 : clamp(tx, hw, gw - hw);
      ty = hh * 2 >= gh ? gh / 2 : clamp(ty, hh, gh - hh);
      this.camTarget.x = tx;
      this.camTarget.y = ty;
      var k = Math.min(1, dt * 10);
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
    }

    worldToScreen(x, y) {
      return {
        x: this.viewW / 2 + (x - this.cam.x) * this.cam.zoom,
        y: this.viewH / 2 + (y - this.cam.y) * this.cam.zoom
      };
    }

    screenToWorld(x, y) {
      return {
        x: (x - this.viewW / 2) / this.cam.zoom + this.cam.x,
        y: (y - this.viewH / 2) / this.cam.zoom + this.cam.y
      };
    }

    /* ------------------------------- цикл ------------------------------- */

    update(dt) {
      this.time += dt;
      if (this.game && this.game.grid.ownerRev !== this.rev) this.rebuild();

      for (var i = this.effects.length - 1; i >= 0; i--) {
        this.effects[i].t -= dt;
        if (this.effects[i].t <= 0) this.effects.splice(i, 1);
      }
      for (var p = this.particles.length - 1; p >= 0; p--) {
        var pt = this.particles[p];
        pt.life -= dt;
        if (pt.life <= 0) { this.particles.splice(p, 1); continue; }
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vx *= 0.93;
        pt.vy *= 0.93;
      }
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.4);
    }

    /* Пастельный фон с мягкими пятнами: градиенты считаются один раз. */
    buildBackground(W, H) {
      var cv = document.createElement('canvas');
      cv.width = Math.max(2, Math.round(W * this.dpr));
      cv.height = Math.max(2, Math.round(H * this.dpr));
      var g = cv.getContext('2d');
      g.scale(this.dpr, this.dpr);
      var bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#eaf3ef');
      bg.addColorStop(0.55, '#e6eef6');
      bg.addColorStop(1, '#f2ece1');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      var blobs = [
        { x: 0.18, y: 0.16, r: 0.30, c: 'rgba(120, 220, 190, 0.22)' },
        { x: 0.82, y: 0.22, r: 0.26, c: 'rgba(130, 180, 255, 0.20)' },
        { x: 0.68, y: 0.86, r: 0.34, c: 'rgba(255, 200, 130, 0.20)' },
        { x: 0.10, y: 0.78, r: 0.24, c: 'rgba(255, 160, 190, 0.16)' }
      ];
      for (var i = 0; i < blobs.length; i++) {
        var bl = blobs[i];
        var bx = bl.x * W, by = bl.y * H, br = bl.r * Math.max(W, H);
        var rg = g.createRadialGradient(bx, by, 0, bx, by, br);
        rg.addColorStop(0, bl.c);
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = rg;
        g.fillRect(bx - br, by - br, br * 2, br * 2);
      }
      this.bgCanvas = cv;
    }

    /* Спрайт мягкого свечения: вместо градиента на каждого игрока каждый кадр. */
    buildGlow() {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      var g = cv.getContext('2d');
      var rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      rg.addColorStop(0, 'rgba(255,255,255,0.55)');
      rg.addColorStop(0.45, 'rgba(255,255,255,0.20)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, 64, 64);
      this.glow = cv;
    }

    draw(dt) {
      var ctx = this.ctx;
      var W = this.viewW, H = this.viewH;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // фон вне арены: статичная картинка, готовится один раз при resize
      if (!this.bgCanvas) this.buildBackground(W, H);
      ctx.drawImage(this.bgCanvas, 0, 0, W, H);

      var g = this.game;
      if (!g) return;
      var me = g.players[0];
      var tx, ty;
      if (me && me.alive) {
        tx = me.x + Math.cos(me.angle) * 3.2;
        ty = me.y + Math.sin(me.angle) * 3.2;
      } else {
        tx = this.camTarget.x; ty = this.camTarget.y;
      }
      var visible = Math.min(this.viewW, this.viewH) < 620 ? 21 : 30;
      var targetZoom = Math.min(this.viewW, this.viewH) / visible;
      if (this.overview && g.grid.circle) {
        // режим обзора: вся арена в кадре (демо и отладка)
        this.cam.x = g.grid.circle.cx;
        this.cam.y = g.grid.circle.cy;
        this.camTarget.x = this.cam.x;
        this.camTarget.y = this.cam.y;
        this.cam.zoom = Math.min(this.viewW, this.viewH) / (g.grid.circle.r * 2.1);
        return;
      }
      this.cam.zoom += (targetZoom - this.cam.zoom) * Math.min(1, dt * 3.5);

      var hw = this.viewW / (2 * this.cam.zoom);
      var hh = this.viewH / (2 * this.cam.zoom);
      var gw = g.grid.w, gh = g.grid.h;
      tx = hw * 2 >= gw ? gw / 2 : clamp(tx, hw, gw - hw);
      ty = hh * 2 >= gh ? gh / 2 : clamp(ty, hh, gh - hh);
      this.camTarget.x = tx;
      this.camTarget.y = ty;
      var k = Math.min(1, dt * 10);
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
    }

    worldToScreen(x, y) {
      return {
        x: this.viewW / 2 + (x - this.cam.x) * this.cam.zoom,
        y: this.viewH / 2 + (y - this.cam.y) * this.cam.zoom
      };
    }

    screenToWorld(x, y) {
      return {
        x: (x - this.viewW / 2) / this.cam.zoom + this.cam.x,
        y: (y - this.viewH / 2) / this.cam.zoom + this.cam.y
      };
    }

    /* ------------------------------- цикл ------------------------------- */

    update(dt) {
      this.time += dt;
      if (this.game && this.game.grid.ownerRev !== this.rev) this.rebuild();

      for (var i = this.effects.length - 1; i >= 0; i--) {
        this.effects[i].t -= dt;
        if (this.effects[i].t <= 0) this.effects.splice(i, 1);
      }
      for (var p = this.particles.length - 1; p >= 0; p--) {
        var pt = this.particles[p];
        pt.life -= dt;
        if (pt.life <= 0) { this.particles.splice(p, 1); continue; }
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vx *= 0.93;
        pt.vy *= 0.93;
      }
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.4);
    }

    /* Пастельный фон с мягкими пятнами: градиенты считаются один раз. */
    buildBackground(W, H) {
      var cv = document.createElement('canvas');
      cv.width = Math.max(2, Math.round(W * this.dpr));
      cv.height = Math.max(2, Math.round(H * this.dpr));
      var g = cv.getContext('2d');
      g.scale(this.dpr, this.dpr);
      var bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#eaf3ef');
      bg.addColorStop(0.55, '#e6eef6');
      bg.addColorStop(1, '#f2ece1');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      var blobs = [
        { x: 0.18, y: 0.16, r: 0.30, c: 'rgba(120, 220, 190, 0.22)' },
        { x: 0.82, y: 0.22, r: 0.26, c: 'rgba(130, 180, 255, 0.20)' },
        { x: 0.68, y: 0.86, r: 0.34, c: 'rgba(255, 200, 130, 0.20)' },
        { x: 0.10, y: 0.78, r: 0.24, c: 'rgba(255, 160, 190, 0.16)' }
      ];
      for (var i = 0; i < blobs.length; i++) {
        var bl = blobs[i];
        var bx = bl.x * W, by = bl.y * H, br = bl.r * Math.max(W, H);
        var rg = g.createRadialGradient(bx, by, 0, bx, by, br);
        rg.addColorStop(0, bl.c);
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = rg;
        g.fillRect(bx - br, by - br, br * 2, br * 2);
      }
      this.bgCanvas = cv;
    }

    /* Спрайт мягкого свечения: вместо градиента на каждого игрока каждый кадр. */
    buildGlow() {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      var g = cv.getContext('2d');
      var rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      rg.addColorStop(0, 'rgba(255,255,255,0.55)');
      rg.addColorStop(0.45, 'rgba(255,255,255,0.20)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, 64, 64);
      this.glow = cv;
    }

    draw(dt) {
      var ctx = this.ctx;
      var W = this.viewW, H = this.viewH;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // фон вне арены: пастель с мягкими пятнами
      var bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#eaf3ef');
      bg.addColorStop(0.55, '#e6eef6');
      bg.addColorStop(1, '#f2ece1');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      if (!this.blobs) {
        this.blobs = [
          { x: 0.18, y: 0.16, r: 0.30, c: 'rgba(120, 220, 190, 0.22)' },
          { x: 0.82, y: 0.22, r: 0.26, c: 'rgba(130, 180, 255, 0.20)' },
          { x: 0.68, y: 0.86, r: 0.34, c: 'rgba(255, 200, 130, 0.20)' },
          { x: 0.10, y: 0.78, r: 0.24, c: 'rgba(255, 160, 190, 0.16)' }
        ];
      }
      for (var bi = 0; bi < this.blobs.length; bi++) {
        var bl = this.blobs[bi];
        var bx = bl.x * W, by = bl.y * H, br = bl.r * Math.max(W, H);
        var rg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        rg.addColorStop(0, bl.c);
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(bx - br, by - br, br * 2, br * 2);
      }

      var g = this.game;
      if (!g) return;

      this.updateCamera(dt || 0.016);
      var z = this.cam.zoom;
      ctx.save();
      if (this.shake > 0.01 && this.opts.shakeEnabled !== false) {
        ctx.translate((Math.random() - 0.5) * this.shake * 9, (Math.random() - 0.5) * this.shake * 9);
      }
      ctx.translate(W / 2, H / 2);
      ctx.scale(z, z);
      ctx.translate(-this.cam.x, -this.cam.y);

      this.drawArena(ctx);
      this.drawTerritory(ctx);
      this.drawTrails(ctx);
      this.drawFlashes(ctx);
      this.drawPlayers(ctx);
      this.drawParticles(ctx);
      ctx.restore();

      this.drawMinimap(ctx, W, H);
    }

    /* Круглая «бумажная» арена: заливка только по видимой области,
     * узор-паттерн создаётся один раз. */
    drawArena(ctx) {
      var g = this.game.grid;
      var z = this.cam.zoom;
      var c = g.circle || { cx: g.w / 2, cy: g.h / 2, r: Math.min(g.w, g.h) / 2 };

      // видимый прямоугольник мира — чтобы не заливать всю карту
      var hw = this.viewW / (2 * z), hh = this.viewH / (2 * z);
      var vx = Math.max(c.cx - c.r, this.cam.x - hw);
      var vy = Math.max(c.cy - c.r, this.cam.y - hh);
      var vw = Math.min(c.cx + c.r, this.cam.x + hw) - vx;
      var vh = Math.min(c.cy + c.r, this.cam.y + hh) - vy;
      if (vw <= 0 || vh <= 0) return;

      // мягкая внешняя тень вокруг круга
      ctx.save();
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, c.r + 1.6, 0, TAU);
      ctx.fillStyle = 'rgba(46, 54, 44, 0.10)';
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, c.r, 0, TAU);
      ctx.clip();
      ctx.fillStyle = '#f6f2e9';
      ctx.fillRect(vx, vy, vw, vh);

      // точки-сетка
      if (!this.dotPat) {
        this.dotPat = ctx.createPattern(this.dotPattern, 'repeat');
        if (this.dotPat && this.dotPat.setTransform && typeof DOMMatrix !== 'undefined') {
          try { this.dotPat.setTransform(new DOMMatrix().scaleSelf(4 / 16)); } catch (e) {}
        }
      }
      if (this.dotPat) {
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = this.dotPat;
        ctx.fillRect(vx, vy, vw, vh);
        ctx.restore();
      }

      // тень у кромки изнутри
      if (!this.arenaGrad) {
        var grd = ctx.createRadialGradient(c.cx, c.cy, c.r * 0.82, c.cx, c.cy, c.r);
        grd.addColorStop(0, 'rgba(120,110,90,0)');
        grd.addColorStop(1, 'rgba(120,110,90,0.20)');
        this.arenaGrad = grd;
      }
      ctx.fillStyle = this.arenaGrad;
      ctx.fillRect(vx, vy, vw, vh);
      ctx.restore();

      // светлая кромка и очень мягкий «опасный» обод
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, c.r, 0, TAU);
      ctx.lineWidth = 2 / z;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();
      ctx.lineWidth = 9 / z;
      ctx.strokeStyle = 'rgba(90, 84, 66, 0.07)';
      ctx.stroke();
    }

    drawTerritory(ctx) {
      if (!this.paths.size) return;
      var ctx2 = ctx;
      var self = this;

      // тень под «вырезанной» землёй
      ctx.save();
      ctx.translate(0, 1.0);
      ctx.fillStyle = 'rgba(44, 52, 42, 0.13)';
      this.paths.forEach(function (path) { ctx2.fill(path); });
      ctx.restore();

      this.paths.forEach(function (path, id) {
        var skin = self.skinById[id] || PIO.SKINS[0];
        ctx.fillStyle = skin.land;
        ctx.fill(path);
        var pat = self.patternFor(skin);
        if (pat) {
          ctx.save();
          ctx.globalAlpha = 0.42;
          ctx.fillStyle = pat;
          ctx.fill(path);
          ctx.restore();
        }
        ctx.strokeStyle = skin.edge || 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 0.7;
        ctx.stroke(path);
      });
    }

    drawTrails(ctx) {
      var players = this.game.players;
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (var i = 0; i < players.length; i++) {
        var p = players[i];
        if (!p.alive) continue;
        var path = p.trailPath;
        if (!path || path.length < 2) continue;

        // длинный след прореживаем: визуально то же, точек вдвое меньше
        var step = path.length > 90 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (var k = step; k < path.length; k += step) ctx.lineTo(path[k].x, path[k].y);
        var last = path[path.length - 1];
        ctx.lineTo(last.x, last.y);

        var mine = i === 0;
        if (mine) {
          ctx.strokeStyle = p.palette.trail;
          ctx.globalAlpha = 0.15 * this.quality;
          ctx.lineWidth = 3.2;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = p.palette.trail;
        ctx.lineWidth = mine ? 2.0 : 1.7;
        ctx.stroke();

        ctx.globalAlpha = mine ? 0.5 : 0.32;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = mine ? 0.75 : 0.55;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    drawFlashes(ctx) {
      var g = this.game.grid;
      var w = g.w;
      ctx.save();
      for (var e = 0; e < this.effects.length; e++) {
        var ef = this.effects[e];
        if (ef.type === 'cells') {
          ctx.fillStyle = 'rgba(255,255,255,' + (ef.t / ef.dur * 0.55).toFixed(3) + ')';
          for (var i = 0; i < ef.cells.length; i++) {
            var idx = ef.cells[i];
            ctx.fillRect(idx % w, (idx / w) | 0, 1, 1);
          }
        } else if (ef.type === 'ring') {
          var k = 1 - ef.t / ef.dur;
          ctx.beginPath();
          ctx.arc(ef.x, ef.y, 0.6 + k * (ef.r || 4), 0, TAU);
          ctx.strokeStyle = ef.color;
          ctx.globalAlpha = (1 - k) * 0.6;
          ctx.lineWidth = 0.5 * (1 - k) + 0.08;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
    }

    drawPlayers(ctx) {
      var players = this.game.players;
      var z = this.cam.zoom;
      var t = this.time;
      for (var i = 0; i < players.length; i++) {
        var p = players[i];
        if (!p.alive) continue;
        var skin = this.skinById[p.id] || PIO.skinById(p.skinId);
        var speedFactor = p.trail && p.trail.size > 0 ? 1 : 0.55;
        var scale = 1.28;

        // мягкий ореол: спрайт вместо расчёта градиента в кадре
        if (!this.glow) this.buildGlow();
        var haloR = i === 0 ? 3.1 : 2.4;
        ctx.globalAlpha = i === 0 ? 0.85 : 0.5;
        ctx.drawImage(this.glow, p.x - haloR, p.y - haloR, haloR * 2, haloR * 2);
        ctx.globalAlpha = 1;
        PIO.drawSkin(ctx, skin.id, p.x, p.y, p.angle, scale, {
          t: t + p.bob,
          move: speedFactor,
          squash: Math.max(0, Math.sin(t * 9 + p.bob)) * 0.35 * speedFactor
        });

        if (z > 9) {
          ctx.font = '0.9px "Segoe UI", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = i === 0 ? 'rgba(24,32,48,0.9)' : 'rgba(40,52,74,0.62)';
          ctx.fillText(p.name, p.x, p.y - 2.15);
        }
      }
    }

    drawParticles(ctx) {
      ctx.save();
      for (var i = 0; i < this.particles.length; i++) {
        var pt = this.particles[i];
        ctx.globalAlpha = Math.max(0, Math.min(1, pt.life / pt.max));
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    /* Мини-карта: перерисовывается в свой маленький canvas не чаще 10 раз в
     * секунду, в кадре — только дешёвый drawImage. */
    drawMinimap(ctx, W, H) {
      if (!this.minimapOn) return;
      var small = Math.min(W, H) < 620;
      var size = Math.max(small ? 112 : 168, Math.min(small ? 168 : 248, Math.min(W, H) * (small ? 0.27 : 0.32)));
      var pad = small ? 10 : 16;
      var x = pad;
      var y = H - size - pad;
      this.minimapRect = { x: x, y: y, size: size };

      if (this._mmDirty || this.time - this._mmLast > 0.1) {
        this.renderMinimap();
        this._mmLast = this.time;
        this._mmDirty = false;
      }

      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, size, size, 16);
      else ctx.rect(x, y, size, size);
      ctx.fillStyle = 'rgba(250,247,240,0.96)';
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.drawImage(this.mmCanvas, 0, 0, 256, 256, x, y, size, size);
      ctx.restore();
      ctx.strokeStyle = 'rgba(40,32,20,0.20)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    renderMinimap() {
      var m = this.mmCtx;
      var S = 256, g = this.game.grid;
      var c = g.circle || { cx: g.w / 2, cy: g.h / 2, r: Math.min(g.w, g.h) / 2 };
      var k = S / (c.r * 2 + 2);
      m.clearRect(0, 0, S, S);

      m.save();
      m.beginPath();
      m.arc(S / 2, S / 2, S / 2 - 1, 0, TAU);
      m.clip();
      m.fillStyle = '#f6f2e9';
      m.fillRect(0, 0, S, S);

      m.save();
      m.translate(S / 2 - c.cx * k, S / 2 - c.cy * k);
      m.scale(k, k);
      var self = this;
      this.paths.forEach(function (path, id) {
        var skin = self.skinById[id] || PIO.SKINS[0];
        m.fillStyle = skin.land;
        m.fill(path);
      });
      m.restore();

      // головы игроков
      for (var i = 0; i < this.game.players.length; i++) {
        var p = this.game.players[i];
        if (!p.alive) continue;
        var px = S / 2 + (p.x - c.cx) * k;
        var py = S / 2 + (p.y - c.cy) * k;
        m.beginPath();
        m.arc(px, py, i === 0 ? 5 : 3.4, 0, TAU);
        m.fillStyle = i === 0 ? '#1d2638' : p.palette.head;
        m.fill();
        if (i === 0) {
          m.lineWidth = 2;
          m.strokeStyle = '#fff';
          m.stroke();
        }
      }
      m.restore();

      // рамка видимой области
      var vz = this.cam.zoom;
      var vw = (this.viewW / vz) * k, vh = (this.viewH / vz) * k;
      var vx = S / 2 + (this.cam.x - this.viewW / (2 * vz) - c.cx) * k;
      var vy = S / 2 + (this.cam.y - this.viewH / (2 * vz) - c.cy) * k;
      m.strokeStyle = 'rgba(29,38,56,0.32)';
      m.lineWidth = 1.5;
      m.strokeRect(vx, vy, vw, vh);
    }
  }

  root.PIO = root.PIO || {};
  root.PIO.Renderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
