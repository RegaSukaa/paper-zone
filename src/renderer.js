/* ============================================================================
 * renderer.js — отрисовка поля, территории, следов, эффектов и мини-карты.
 * Территория рисуется через закадровый растр (1 клетка = 1 пиксель), который
 * пересобирается только при изменении владельцев (grid.ownerRev), а не каждый
 * кадр. Следы рисуются полилинией по точкам пути.
 * ==========================================================================*/
(function (root) {
  'use strict';

  var SKINS = root.PIO.SKINS;
  var hexToRgb = root.PIO.hexToRgb;
  var clamp = root.PIO.clamp;

  var rgbCache = {};
  function rgb(hex) {
    if (!rgbCache[hex]) rgbCache[hex] = hexToRgb(hex);
    return rgbCache[hex];
  }

  var TAU = Math.PI * 2;

  class Renderer {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.opts = opts || {};
      this.game = null;
      this.rev = -1;
      this.skinById = {};
      this.cam = { x: 0, y: 0, zoom: 12 };
      this.camTarget = { x: 0, y: 0 };
      this.effects = [];
      this.particles = [];
      this.shake = 0;
      this.viewW = 1;
      this.viewH = 1;
      this.dpr = 1;
      this.frame = 0;
      this.minimapOn = true;
      this.vignette = null;

      this.terr = document.createElement('canvas');
      this.terrCtx = this.terr.getContext('2d');
      this.edge = document.createElement('canvas');
      this.edgeCtx = this.edge.getContext('2d');

      this.resize();
    }

    resize() {
      var w = window.innerWidth;
      var h = window.innerHeight;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, Math.round(w * this.dpr));
      this.canvas.height = Math.max(1, Math.round(h * this.dpr));
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.viewW = w;
      this.viewH = h;
      this.vignette = null;
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
        this.skinById[p.id] = SKINS[p.skin % SKINS.length];
      }
      var g = game.grid;
      this.terr.width = g.w;
      this.terr.height = g.h;
      this.edge.width = g.w;
      this.edge.height = g.h;
      var me = game.players[0];
      this.cam.x = this.camTarget.x = me ? me.x : g.w / 2;
      this.cam.y = this.camTarget.y = me ? me.y : g.h / 2;
      this.cam.zoom = this.viewH / 38;
      this.rebuild();
    }

    /* Пересборка растра территории: только при изменении владельцев. */
    rebuild() {
      if (!this.game) return;
      var g = this.game.grid;
      var w = g.w, h = g.h, size = g.size;
      var owner = g.owner, wall = g.wall;
      var fillImg = this.terrCtx.createImageData(w, h);
      var edgeImg = this.edgeCtx.createImageData(w, h);
      var fd = fillImg.data, ed = edgeImg.data;
      var x, y, i, o, id, skin, land, edgeColor, isEdge, k, j;

      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          i = y * w + x;
          o = i * 4;
          if (wall[i]) {
            fd[o] = 46; fd[o + 1] = 54; fd[o + 2] = 74; fd[o + 3] = 255;
            continue;
          }
          id = owner[i];
          if (!id) continue;
          skin = this.skinById[id] || SKINS[(id - 1) % SKINS.length];
          land = rgb(skin.land);
          fd[o] = land[0]; fd[o + 1] = land[1]; fd[o + 2] = land[2]; fd[o + 3] = 255;

          isEdge = (x === 0 || y === 0 || x === w - 1 || y === h - 1);
          if (!isEdge) {
            for (k = 0; k < 4; k++) {
              j = k === 0 ? i - 1 : k === 1 ? i + 1 : k === 2 ? i - w : i + w;
              if (owner[j] !== id) { isEdge = true; break; }
            }
          }
          if (isEdge) {
            edgeColor = rgb(skin.edge);
            ed[o] = edgeColor[0]; ed[o + 1] = edgeColor[1]; ed[o + 2] = edgeColor[2]; ed[o + 3] = 255;
          }
        }
      }
      this.terrCtx.putImageData(fillImg, 0, 0);
      this.edgeCtx.putImageData(edgeImg, 0, 0);
      this.rev = g.ownerRev;
    }

    /* ------------------------------ эффекты ----------------------------- */

    addCaptureEffect(ev) {
      this.captureCount = (this.captureCount || 0) + 1;
      var cells = (ev.enclosed || []).concat(ev.trail || []);
      if (cells.length > 700) {
        var step = Math.ceil(cells.length / 700);
        var trimmed = [];
        for (var i = 0; i < cells.length; i += step) trimmed.push(cells[i]);
        cells = trimmed;
      }
      if (!cells.length) return;
      this.effects.push({ type: 'cells', cells: cells, t: 0.34, dur: 0.34 });
      if (this.effects.filter(function (e) { return e.type === 'cells'; }).length > 5) {
        for (var k = 0; k < this.effects.length; k++) {
          if (this.effects[k].type === 'cells') { this.effects.splice(k, 1); break; }
        }
      }
    }

    addDeathEffect(x, y, color) {
      this.effects.push({ type: 'ring', x: x, y: y, t: 0.5, dur: 0.5, color: color });
      for (var i = 0; i < 16; i++) {
        var a = Math.random() * TAU;
        var sp = 3 + Math.random() * 9;
        this.particles.push({
          x: x, y: y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 0.5 + Math.random() * 0.35,
          max: 0.85,
          size: 0.16 + Math.random() * 0.22,
          color: color
        });
      }
      if (this.particles.length > 260) this.particles.splice(0, this.particles.length - 260);
      this.shake = Math.min(1, this.shake + 0.45);
    }

    /* ------------------------------ камера ------------------------------ */

    updateCamera(dt) {
      var g = this.game;
      if (!g) return;
      var me = g.players[0];
      var tx, ty;
      if (me && me.alive) {
        tx = me.x + me.dir.x * 2.4;
        ty = me.y + me.dir.y * 2.4;
      } else {
        tx = this.camTarget.x;
        ty = this.camTarget.y;
      }
      var visible = Math.min(this.viewW, this.viewH) < 620 ? 27 : 40;
      var targetZoom = Math.min(this.viewW, this.viewH) / visible;
      this.cam.zoom += (targetZoom - this.cam.zoom) * Math.min(1, dt * 4);

      var hw = this.viewW / (2 * this.cam.zoom);
      var hh = this.viewH / (2 * this.cam.zoom);
      var gw = g.grid.w, gh = g.grid.h;
      if (hw * 2 >= gw) tx = gw / 2;
      else tx = clamp(tx, hw, gw - hw);
      if (hh * 2 >= gh) ty = gh / 2;
      else ty = clamp(ty, hh, gh - hh);

      this.camTarget.x = tx;
      this.camTarget.y = ty;
      var k = Math.min(1, dt * 9);
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
    }

    worldToScreen(x, y) {
      return {
        x: this.viewW / 2 + (x - this.cam.x) * this.cam.zoom,
        y: this.viewH / 2 + (y - this.cam.y) * this.cam.zoom
      };
    }

    /* ------------------------------- отрисовка -------------------------- */

    update(dt) {
      this.frame++;
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
        pt.vx *= 0.94;
        pt.vy *= 0.94;
      }
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.6);
    }

    draw(dt) {
      var ctx = this.ctx;
      var W = this.viewW, H = this.viewH;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      var bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0a1020');
      bg.addColorStop(1, '#05070e');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      var g = this.game;
      if (!g) return;

      this.updateCamera(dt || 0.016);

      var z = this.cam.zoom;
      ctx.save();
      if (this.shake > 0.01) {
        ctx.translate((Math.random() - 0.5) * this.shake * 11, (Math.random() - 0.5) * this.shake * 11);
      }
      ctx.translate(W / 2, H / 2);
      ctx.scale(z, z);
      ctx.translate(-this.cam.x, -this.cam.y);

      this.drawArena(ctx);
      this.drawTerritory(ctx);
      this.drawFlashes(ctx);
      this.drawTrails(ctx);
      this.drawHeads(ctx);
      this.drawParticles(ctx);
      ctx.restore();

      if (this.vignette === null) this.buildVignette();
      if (this.vignette) {
        ctx.fillStyle = this.vignette;
        ctx.fillRect(0, 0, W, H);
      }

      if (this.minimapOn && g) this.drawMinimap(ctx, W, H);
    }

    buildVignette() {
      var ctx = this.ctx;
      var W = this.viewW, H = this.viewH;
      var grd = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.78);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,0.5)');
      this.vignette = grd;
    }

    drawArena(ctx) {
      var g = this.game.grid;
      var z = this.cam.zoom;
      ctx.fillStyle = '#0b1120';
      ctx.fillRect(0, 0, g.w, g.h);

      if (z > 5) {
        var step = z > 15 ? 4 : 10;
        ctx.beginPath();
        for (var x = step; x < g.w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, g.h); }
        for (var y = step; y < g.h; y += step) { ctx.moveTo(0, y); ctx.lineTo(g.w, y); }
        ctx.lineWidth = 1 / z;
        ctx.strokeStyle = 'rgba(120,150,220,0.055)';
        ctx.stroke();
      }

      ctx.lineWidth = 2 / z;
      ctx.strokeStyle = 'rgba(255,110,110,0.42)';
      ctx.strokeRect(0.5, 0.5, g.w - 1, g.h - 1);
      ctx.lineWidth = 8 / z;
      ctx.strokeStyle = 'rgba(255,110,110,0.06)';
      ctx.strokeRect(0.5, 0.5, g.w - 1, g.h - 1);
    }

    drawTerritory(ctx) {
      var g = this.game.grid;
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.92;
      ctx.drawImage(this.terr, 0, 0, g.w, g.h);
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(this.edge, 0, 0, g.w, g.h);
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 1;
    }

    drawFlashes(ctx) {
      var g = this.game.grid;
      var w = g.w;
      ctx.save();
      for (var e = 0; e < this.effects.length; e++) {
        var ef = this.effects[e];
        if (ef.type === 'cells') {
          ctx.fillStyle = 'rgba(255,255,255,' + (ef.t / ef.dur * 0.42).toFixed(3) + ')';
          for (var i = 0; i < ef.cells.length; i++) {
            var idx = ef.cells[i];
            ctx.fillRect(idx % w, (idx / w) | 0, 1, 1);
          }
        } else if (ef.type === 'ring') {
          var k = 1 - ef.t / ef.dur;
          ctx.beginPath();
          ctx.arc(ef.x, ef.y, 0.6 + k * 5.5, 0, TAU);
          ctx.strokeStyle = ef.color;
          ctx.globalAlpha = (1 - k) * 0.7;
          ctx.lineWidth = 0.35 * (1 - k) + 0.05;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
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
        if (!path || path.length === 0) continue;
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (var k = 1; k < path.length; k++) ctx.lineTo(path[k].x, path[k].y);
        if (path.length === 1) ctx.lineTo(path[0].x + 0.01, path[0].y);

        ctx.strokeStyle = p.colors.trail;
        ctx.globalAlpha = 0.16;
        ctx.lineWidth = 1.6;
        ctx.stroke();

        ctx.globalAlpha = 1;
        ctx.lineWidth = 0.74;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 0.26;
        ctx.stroke();
      }
      ctx.restore();
    }

    drawHeads(ctx) {
      var players = this.game.players;
      var z = this.cam.zoom;
      ctx.save();
      for (var i = 0; i < players.length; i++) {
        var p = players[i];
        if (!p.alive) continue;
        var r = 0.62;
        var ang = Math.atan2(p.dir.y, p.dir.x);

        ctx.beginPath();
        ctx.arc(p.x, p.y + 0.16, r * 0.95, 0, TAU);
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fillStyle = p.colors.head;
        ctx.fill();
        ctx.lineWidth = 0.13;
        ctx.strokeStyle = 'rgba(8,14,26,0.6)';
        ctx.stroke();

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(r * 1.42, 0);
        ctx.lineTo(r * 0.5, -r * 0.55);
        ctx.lineTo(r * 0.5, r * 0.55);
        ctx.closePath();
        ctx.fillStyle = p.colors.head;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(r * 0.18, 0, r * 0.3, 0, TAU);
        ctx.fillStyle = 'rgba(9,15,28,0.55)';
        ctx.fill();
        ctx.restore();

        if (z > 11 && p.isBot) {
          ctx.font = '0.78px ' + '"Segoe UI", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(233,239,255,0.5)';
          ctx.fillText(p.name, p.x, p.y - r * 1.85);
        }
      }
      ctx.restore();
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
      var g = this.game.grid;
      var size = W < 620 ? 82 : 116;
      var pad = W < 620 ? 10 : 16;
      var x = W - size - pad;
      var y = H - size - pad;
      var scale = (size - 6) / Math.max(g.w, g.h);
      var mw = g.w * scale, mh = g.h * scale;
      var ox = x + (size - mw) / 2, oy = y + (size - mh) / 2;

      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, size, size, 12);
      else ctx.rect(x, y, size, size);
      ctx.fillStyle = 'rgba(8,13,25,0.72)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.terr, ox, oy, mw, mh);
      ctx.globalAlpha = 1;

      for (var i = 0; i < this.game.players.length; i++) {
        var p = this.game.players[i];
        if (!p.alive) continue;
        var px = ox + p.x * scale;
        var py = oy + p.y * scale;
        ctx.beginPath();
        ctx.arc(px, py, i === 0 ? 3.2 : 2.1, 0, TAU);
        ctx.fillStyle = i === 0 ? '#ffffff' : p.colors.head;
        ctx.fill();
      }
      ctx.restore();
    }
  }

  root.PIO = root.PIO || {};
  root.PIO.Renderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
