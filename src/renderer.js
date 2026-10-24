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

      this.terr = document.createElement('canvas');
      this.terrCtx = this.terr.getContext('2d');
      this.edge = document.createElement('canvas');
      this.edgeCtx = this.edge.getContext('2d');
      this.shadow = document.createElement('canvas');
      this.shadowCtx = this.shadow.getContext('2d');

      this.resize();
      this.buildPattern();
    }

    resize() {
      var w = window.innerWidth, h = window.innerHeight;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, Math.round(w * this.dpr));
      this.canvas.height = Math.max(1, Math.round(h * this.dpr));
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.viewW = w;
      this.viewH = h;
      // на слабых/маленьких экранах меньше частиц и свечения
      this.quality = (w * h < 700000 || (navigator.hardwareConcurrency || 4) <= 4) ? 0.6 : 1;
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
      [this.terr, this.edge, this.shadow].forEach(function (cv) {
        cv.width = g.w; cv.height = g.h;
      });
      var me = game.players[0];
      this.cam.x = this.camTarget.x = me ? me.x : g.w / 2;
      this.cam.y = this.camTarget.y = me ? me.y : g.h / 2;
      this.rebuild();
    }

    registerPlayer(p) {
      this.skinById[p.id] = PIO.skinById(p.skinId);
    }

    /* --------------------------- растр территории ----------------------- */

    rebuild() {
      if (!this.game) return;
      var g = this.game.grid;
      var w = g.w, h = g.h, size = g.size;
      var owner = g.owner, wall = g.wall;
      var fill = this.terrCtx.createImageData(w, h);
      var edge = this.edgeCtx.createImageData(w, h);
      var fd = fill.data, ed = edge.data;
      var x, y, i, o, id, skin, land, edgeC, isEdge, k, j;

      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          i = y * w + x;
          o = i * 4;
          if (wall[i]) {
            fd[o] = 214; fd[o + 1] = 210; fd[o + 2] = 200; fd[o + 3] = 255;
            continue;
          }
          id = owner[i];
          if (!id) continue;
          skin = this.skinById[id] || PIO.SKINS[0];
          land = rgb(skin.land);
          // лёгкая вариация тона по клеткам — «бумажная» фактура, без шума
          var v = ((x * 7 + y * 13) % 5) * 2;
          fd[o] = Math.min(255, land[0] + v);
          fd[o + 1] = Math.min(255, land[1] + v);
          fd[o + 2] = Math.min(255, land[2] + v);
          fd[o + 3] = 255;

          isEdge = (x === 0 || y === 0 || x === w - 1 || y === h - 1);
          if (!isEdge) {
            for (k = 0; k < 4; k++) {
              j = k === 0 ? i - 1 : k === 1 ? i + 1 : k === 2 ? i - w : i + w;
              if (owner[j] !== id) { isEdge = true; break; }
            }
          }
          if (isEdge) {
            edgeC = rgb(skin.edge);
            ed[o] = edgeC[0]; ed[o + 1] = edgeC[1]; ed[o + 2] = edgeC[2]; ed[o + 3] = 255;
          }
        }
      }
      this.terrCtx.putImageData(fill, 0, 0);
      this.edgeCtx.putImageData(edge, 0, 0);

      // тень-подложка: тот же силуэт, но тёмный
      var sh = this.shadowCtx.createImageData(w, h);
      var sd = sh.data;
      for (i = 0; i < size; i++) {
        if (!owner[i]) continue;
        sd[i * 4] = 30;
        sd[i * 4 + 1] = 26;
        sd[i * 4 + 2] = 22;
        sd[i * 4 + 3] = 26;
      }
      this.shadowCtx.putImageData(sh, 0, 0);
      this.rev = g.ownerRev;
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
      var visible = Math.min(this.viewW, this.viewH) < 620 ? 26 : 38;
      var targetZoom = Math.min(this.viewW, this.viewH) / visible;
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

    draw(dt) {
      var ctx = this.ctx;
      var W = this.viewW, H = this.viewH;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // фон вне арены
      var bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#e9e4d8');
      bg.addColorStop(1, '#dcd5c6');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

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

    drawArena(ctx) {
      var g = this.game.grid;
      var z = this.cam.zoom;

      // бумага арены
      ctx.fillStyle = '#f6f2e9';
      ctx.fillRect(0, 0, g.w, g.h);

      // точки-сетка
      if (this.dotPattern) {
        var pat = ctx.createPattern(this.dotPattern, 'repeat');
        if (pat) {
          ctx.save();
          var scale = 4; // клеток между точками
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = pat;
          var m = new DOMMatrix();
          if (typeof m.scaleSelf === 'function') {
            m.scaleSelf(scale / 16, scale / 16);
            pat.setTransform(m);
          }
          ctx.fillRect(0, 0, g.w, g.h);
          ctx.restore();
        }
      }

      // мягкая внутренняя тень у краёв
      var inset = 6;
      var grd = ctx.createLinearGradient(0, 0, 0, inset);
      grd.addColorStop(0, 'rgba(120,110,90,0.20)');
      grd.addColorStop(1, 'rgba(120,110,90,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, g.w, inset);
      var grd2 = ctx.createLinearGradient(0, g.h, 0, g.h - inset);
      grd2.addColorStop(0, 'rgba(120,110,90,0.20)');
      grd2.addColorStop(1, 'rgba(120,110,90,0)');
      ctx.fillStyle = grd2;
      ctx.fillRect(0, g.h - inset, g.w, inset);

      // опасная кромка
      ctx.lineWidth = 3 / z;
      ctx.strokeStyle = 'rgba(226,90,74,0.55)';
      ctx.strokeRect(0.5, 0.5, g.w - 1, g.h - 1);
      ctx.lineWidth = 14 / z;
      ctx.strokeStyle = 'rgba(226,90,74,0.10)';
      ctx.strokeRect(0.5, 0.5, g.w - 1, g.h - 1);
    }

    drawTerritory(ctx) {
      var g = this.game.grid;
      // тень
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.shadow, 0, 1.1, g.w, g.h);
      // заливка
      ctx.globalAlpha = 1;
      ctx.drawImage(this.terr, 0, 0, g.w, g.h);
      // светлый контур
      ctx.globalAlpha = 1;
      ctx.drawImage(this.edge, 0, 0, g.w, g.h);
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
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (var k = 1; k < path.length; k++) ctx.lineTo(path[k].x, path[k].y);

        // ореол
        ctx.strokeStyle = p.palette.trail;
        ctx.globalAlpha = 0.16 * this.quality;
        ctx.lineWidth = 3.4;
        ctx.stroke();

        // тело
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.9;
        ctx.stroke();

        // светлая сердцевина
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }
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

    drawMinimap(ctx, W, H) {
      if (!this.minimapOn) return;
      var g = this.game.grid;
      var size = W < 620 ? 74 : 104;
      var pad = W < 620 ? 10 : 16;
      var x = W - size - pad;
      var y = H - size - pad;
      var scale = (size - 8) / Math.max(g.w, g.h);
      var mw = g.w * scale, mh = g.h * scale;
      var ox = x + (size - mw) / 2, oy = y + (size - mh) / 2;

      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, size, size, 12);
      else ctx.rect(x, y, size, size);
      ctx.fillStyle = 'rgba(246,242,233,0.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,32,20,0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.drawImage(this.terr, ox, oy, mw, mh);

      for (var i = 0; i < this.game.players.length; i++) {
        var p = this.game.players[i];
        if (!p.alive) continue;
        var px = ox + p.x * scale, py = oy + p.y * scale;
        ctx.beginPath();
        ctx.arc(px, py, i === 0 ? 2.8 : 1.9, 0, TAU);
        ctx.fillStyle = i === 0 ? '#1d2638' : p.palette.land;
        ctx.fill();
      }
      ctx.restore();
    }
  }

  root.PIO = root.PIO || {};
  root.PIO.Renderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
