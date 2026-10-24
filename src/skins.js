/* ============================================================================
 * skins.js — система персонажей.
 *
 * Скин = силуэт + материал + палитра территории + собственная отрисовка.
 * Каждый персонаж рисуется в локальных координатах: 1 единица = 1 клетка мира,
 * «вперёд» — направление +X, поэтому рендер просто поворачивает контекст.
 * Файл не трогает DOM: в Node доступны только id/палитры (для логики).
 * ==========================================================================*/
(function (root) {
  'use strict';
  var PIO = root.PIO = root.PIO || {};

  function rr(ctx, x, y, w, h, r) {
    var m = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, m); return; }
    ctx.moveTo(x + m, y);
    ctx.arcTo(x + w, y, x + w, y + h, m);
    ctx.arcTo(x + w, y + h, x, y + h, m);
    ctx.arcTo(x, y + h, x, y, m);
    ctx.arcTo(x, y, x + w, y, m);
    ctx.closePath();
  }

  function ellipse(ctx, x, y, rx, ry, rot) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, Math.PI * 2);
  }

  function eye(ctx, x, y, r, pupil, glow) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    if (glow) {
      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur = r * 2.2;
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(x + r * 0.24, y + r * 0.05, r * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = pupil || '#141a26';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + r * 0.06, y - r * 0.28, r * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
  }

  function limbShadow(ctx) {
    ctx.beginPath();
    ctx.ellipse(-0.1, 0.22, 1.02, 0.92, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,18,30,0.12)';
    ctx.fill();
  }

  function gloss(ctx, x, y, rx, ry, a) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    g.addColorStop(0, 'rgba(255,255,255,' + (a || 0.55) + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  /* ------------------------------ персонажи ------------------------------ */

  var list = [
    {
      id: 'mint', texture: 'dots', name: 'Мята', tag: 'слизь',
      land: '#22c39a', land2: '#0f9a78', edge: '#7ff3d0', trail: '#31dcae',
      head: '#5cf0c6', dark: '#0b3a2e', accent: '#e9fff8',
      draw: function (ctx, o) {
        var sq = 1 + Math.sin(o.t * 7) * 0.045 * o.move - (o.squash || 0) * 0.16;
        ctx.save();
        ctx.scale(1 / sq, sq);
        var g = ctx.createLinearGradient(0, -1, 0, 1);
        g.addColorStop(0, '#7df5cf');
        g.addColorStop(0.55, '#2fdcae');
        g.addColorStop(1, '#0e9c79');
        ellipse(ctx, 0, 0, 1.06, 0.98);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.14;
        ctx.strokeStyle = '#0a6b54';
        ctx.stroke();
        gloss(ctx, -0.3, -0.45, 0.55, 0.42, 0.6);
        // капля-пузырёк
        ellipse(ctx, -0.62, -0.72, 0.2, 0.26);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fill();
        eye(ctx, 0.36, -0.14, 0.24, '#06392d');
        eye(ctx, 0.62, 0.26, 0.18, '#06392d');
        ctx.restore();
      }
    },
    {
      id: 'astro', texture: 'stripes', name: 'Астронавт', tag: 'скафандр',
      land: '#4f7fe8', land2: '#2b53b8', edge: '#9fc0ff', trail: '#6f9bff',
      head: '#dfe9ff', dark: '#1b2b52', accent: '#ffd166',
      draw: function (ctx, o) {
        var tilt = Math.sin(o.t * 5) * 0.05 * o.move;
        ctx.save();
        ctx.rotate(tilt);
        // ранец
        rr(ctx, -1.0, -0.62, 0.5, 1.24, 0.18);
        ctx.fillStyle = '#c9d6f2';
        ctx.fill();
        ctx.lineWidth = 0.1;
        ctx.strokeStyle = '#8fa4cc';
        ctx.stroke();
        // шлем
        var g = ctx.createRadialGradient(-0.25, -0.35, 0.2, 0, 0, 1.15);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#c3d3ef');
        ellipse(ctx, 0, 0, 1.02, 0.98);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.13;
        ctx.strokeStyle = '#8ea3c9';
        ctx.stroke();
        // визор
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(0.34, 0, 0.62, 0.62, 0, -1.1, 1.1);
        ctx.lineTo(0.34, 0);
        ctx.closePath();
        var vg = ctx.createLinearGradient(0.2, -0.5, 0.8, 0.5);
        vg.addColorStop(0, '#243b6b');
        vg.addColorStop(1, '#0d1730');
        ctx.fillStyle = vg;
        ctx.fill();
        ctx.clip();
        ctx.beginPath();
        ctx.ellipse(0.42, -0.28, 0.26, 0.12, -0.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(160,210,255,0.7)';
        ctx.fill();
        ctx.restore();
        eye(ctx, 0.42, 0.06, 0.17, '#eaf4ff');
        // антенна
        ctx.beginPath();
        ctx.moveTo(-0.1, -0.95);
        ctx.lineTo(-0.05, -1.35);
        ctx.lineWidth = 0.09;
        ctx.strokeStyle = '#9aa9c4';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(-0.04, -1.42, 0.14, 0, Math.PI * 2);
        ctx.fillStyle = '#ffcc4d';
        ctx.fill();
        ctx.restore();
      }
    },
    {
      id: 'robot', texture: 'grid', name: 'Робот', tag: 'механика',
      land: '#7b8fa8', land2: '#4f6076', edge: '#c6d6ea', trail: '#93a9c4',
      head: '#dbe6f5', dark: '#1d2836', accent: '#49e0ff',
      draw: function (ctx, o) {
        var bob = Math.sin(o.t * 8) * 0.04 * o.move;
        ctx.save();
        ctx.translate(0, bob);
        rr(ctx, -0.95, -0.9, 1.9, 1.8, 0.42);
        var g = ctx.createLinearGradient(0, -0.9, 0, 0.9);
        g.addColorStop(0, '#f2f7ff');
        g.addColorStop(0.6, '#cdd9ea');
        g.addColorStop(1, '#93a4bb');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.13;
        ctx.strokeStyle = '#4a5a70';
        ctx.stroke();
        // визор
        rr(ctx, 0.1, -0.42, 0.78, 0.5, 0.2);
        ctx.fillStyle = '#16222e';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0.5, -0.17, 0.09, 0, Math.PI * 2);
        ctx.fillStyle = '#49e0ff';
        ctx.fill();
        // болты
        [[-0.62, -0.66], [-0.62, 0.66], [-0.55, 0]].forEach(function (pt) {
          ctx.beginPath();
          ctx.arc(pt[0], pt[1], 0.1, 0, Math.PI * 2);
          ctx.fillStyle = '#7d90a8';
          ctx.fill();
        });
        // антенна
        ctx.beginPath();
        ctx.moveTo(-0.2, -0.9);
        ctx.lineTo(-0.15, -1.3);
        ctx.strokeStyle = '#6d7d93';
        ctx.lineWidth = 0.1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(-0.14, -1.38, 0.12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,90,90,' + (0.55 + 0.45 * Math.sin(o.t * 6)) + ')';
        ctx.fill();
        ctx.restore();
      }
    },
    {
      id: 'flame', texture: 'waves', name: 'Пламя', tag: 'огонь',
      land: '#f2701d', land2: '#b93a08', edge: '#ffc46b', trail: '#ff9a3c',
      head: '#ffd166', dark: '#3a1200', accent: '#fff1b8',
      draw: function (ctx, o) {
        var f = Math.sin(o.t * 12) * 0.08 * o.move;
        ctx.save();
        // языки
        ctx.beginPath();
        ctx.moveTo(1.05, 0.1);
        ctx.quadraticCurveTo(0.55, -1.15 - f, -0.05, -0.55);
        ctx.quadraticCurveTo(-0.35, -1.5 + f, -0.75, -0.3);
        ctx.quadraticCurveTo(-1.15, 0.55, -0.2, 0.95);
        ctx.quadraticCurveTo(0.6, 1.15, 1.05, 0.1);
        var g = ctx.createRadialGradient(0.1, 0.15, 0.1, 0, 0, 1.3);
        g.addColorStop(0, '#fff6c8');
        g.addColorStop(0.45, '#ffc23c');
        g.addColorStop(1, '#e4530a');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.12;
        ctx.strokeStyle = 'rgba(160,50,0,0.55)';
        ctx.stroke();
        eye(ctx, 0.34, -0.1, 0.2, '#2b0d00');
        eye(ctx, 0.05, 0.35, 0.16, '#2b0d00');
        ctx.restore();
      }
    },
    {
      id: 'crystal', texture: 'facets', name: 'Кристалл', tag: 'минерал',
      land: '#8a5cf6', land2: '#5a2fc4', edge: '#d3b6ff', trail: '#a97dff',
      head: '#c9a8ff', dark: '#2a1553', accent: '#f0e5ff',
      draw: function (ctx, o) {
        var pulse = 1 + Math.sin(o.t * 4) * 0.05;
        ctx.save();
        ctx.scale(pulse, 1 / pulse);
        ctx.beginPath();
        ctx.moveTo(1.05, 0); ctx.lineTo(0.4, -0.95); ctx.lineTo(-0.75, -0.6);
        ctx.lineTo(-1.0, 0.15); ctx.lineTo(-0.15, 1.0); ctx.lineTo(0.8, 0.62);
        ctx.closePath();
        var g = ctx.createLinearGradient(-0.8, -0.8, 0.9, 0.9);
        g.addColorStop(0, '#e6d5ff');
        g.addColorStop(0.5, '#a273ff');
        g.addColorStop(1, '#5f2fd0');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.12;
        ctx.strokeStyle = '#3b1a86';
        ctx.stroke();
        // грани
        ctx.beginPath();
        ctx.moveTo(0.4, -0.95); ctx.lineTo(0.1, 0.1); ctx.lineTo(0.8, 0.62);
        ctx.moveTo(0.1, 0.1); ctx.lineTo(-0.75, -0.6);
        ctx.strokeStyle = 'rgba(80,40,160,0.45)';
        ctx.lineWidth = 0.06;
        ctx.stroke();
        gloss(ctx, -0.25, -0.4, 0.4, 0.28, 0.75);
        eye(ctx, 0.38, -0.05, 0.17, '#2a1553');
        eye(ctx, 0.1, 0.42, 0.13, '#2a1553');
        ctx.restore();
      }
    },
    {
      id: 'bolt', texture: 'streaks', name: 'Разряд', tag: 'энергия',
      land: '#e8c400', land2: '#a98f00', edge: '#fff58a', trail: '#ffe23c',
      head: '#fff08a', dark: '#33280a', accent: '#ffffff',
      draw: function (ctx, o) {
        var flick = 0.85 + 0.15 * Math.sin(o.t * 22);
        ctx.save();
        ctx.scale(flick, 1);
        ctx.beginPath();
        ctx.moveTo(1.05, -0.35); ctx.lineTo(0.15, -0.3); ctx.lineTo(0.75, -1.0);
        ctx.lineTo(-0.2, -0.15); ctx.lineTo(-0.65, -0.75); ctx.lineTo(-0.5, 0.15);
        ctx.lineTo(-1.0, 0.45); ctx.lineTo(-0.05, 0.6); ctx.lineTo(-0.35, 1.0);
        ctx.lineTo(0.6, 0.5); ctx.lineTo(0.95, 0.35);
        ctx.closePath();
        var g = ctx.createRadialGradient(0, 0, 0.1, 0, 0, 1.2);
        g.addColorStop(0, '#fffbe0');
        g.addColorStop(0.5, '#ffe23c');
        g.addColorStop(1, '#c9a300');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.1;
        ctx.strokeStyle = '#8a6f00';
        ctx.stroke();
        eye(ctx, 0.35, -0.12, 0.2, '#2b2200');
        eye(ctx, 0.02, 0.33, 0.14, '#2b2200');
        ctx.restore();
      }
    },
    {
      id: 'drone', texture: 'grid', name: 'Дрон', tag: 'техника',
      land: '#0fa3c4', land2: '#0a6f8a', edge: '#7fe6ff', trail: '#2ec8e8',
      head: '#c9f4ff', dark: '#06303c', accent: '#ff7ab6',
      draw: function (ctx, o) {
        var spin = o.t * 18;
        ctx.save();
        // пропеллеры
        [[-0.5, -0.75], [-0.5, 0.75]].forEach(function (pt) {
          ctx.save();
          ctx.translate(pt[0], pt[1]);
          ctx.rotate(spin);
          ellipse(ctx, 0, 0, 0.42, 0.08);
          ctx.fillStyle = 'rgba(180,240,255,0.65)';
          ctx.fill();
          ctx.restore();
        });
        // корпус
        rr(ctx, -0.95, -0.7, 1.9, 1.4, 0.58);
        var g = ctx.createLinearGradient(0, -0.7, 0, 0.7);
        g.addColorStop(0, '#f0fbff');
        g.addColorStop(0.55, '#9fdcf0');
        g.addColorStop(1, '#3a8ea6');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.12;
        ctx.strokeStyle = '#0b4c5e';
        ctx.stroke();
        // линза
        ctx.beginPath();
        ctx.arc(0.42, 0, 0.34, 0, Math.PI * 2);
        ctx.fillStyle = '#08222b';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0.5, -0.1, 0.12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(120,240,255,0.85)';
        ctx.fill();
        // полоса-акцент
        rr(ctx, -0.72, -0.12, 0.6, 0.24, 0.12);
        ctx.fillStyle = '#ff7ab6';
        ctx.fill();
        ctx.restore();
      }
    },
    {
      id: 'jelly', texture: 'dots', name: 'Желе', tag: 'гель',
      land: '#ef6aa8', land2: '#bb3a78', edge: '#ffb3d4', trail: '#ff85bd',
      head: '#ffc2dd', dark: '#4a1030', accent: '#ffe3f1',
      draw: function (ctx, o) {
        var wob = Math.sin(o.t * 6) * 0.06;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(-0.95, 0.2);
        ctx.bezierCurveTo(-1.0, -1.1, 1.0, -1.1, 0.98, 0.15);
        ctx.bezierCurveTo(0.9, 0.6 + wob, 0.35, 0.42 - wob, 0.0, 0.7);
        ctx.bezierCurveTo(-0.35, 0.95, -0.45, 0.35, -0.95, 0.2);
        ctx.closePath();
        var g = ctx.createLinearGradient(0, -1, 0, 0.9);
        g.addColorStop(0, 'rgba(255,214,236,0.95)');
        g.addColorStop(0.6, 'rgba(240,110,175,0.92)');
        g.addColorStop(1, 'rgba(190,50,120,0.9)');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.1;
        ctx.strokeStyle = 'rgba(120,20,70,0.5)';
        ctx.stroke();
        [[-0.35, -0.35, 0.11], [0.1, -0.6, 0.07], [-0.1, 0.15, 0.09]].forEach(function (p) {
          ctx.beginPath();
          ctx.arc(p[0], p[1], p[2], 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.fill();
        });
        eye(ctx, 0.4, -0.2, 0.19, '#4a1030');
        eye(ctx, 0.1, 0.1, 0.15, '#4a1030');
        ctx.restore();
      }
    },
    {
      id: 'cat', texture: 'stripes', name: 'Неон-кот', tag: 'зверь',
      land: '#13b8a6', land2: '#0a7f74', edge: '#7cf7e6', trail: '#2fe0cb',
      head: '#b8fff4', dark: '#04322d', accent: '#ff7ad9',
      draw: function (ctx, o) {
        var ear = Math.sin(o.t * 5) * 0.06;
        ctx.save();
        // уши
        [[-0.35, -0.85, -0.15], [-0.2, 0.85, 0.15]].forEach(function (e) {
          ctx.beginPath();
          ctx.moveTo(e[0] - 0.25, e[1]);
          ctx.lineTo(e[0] + 0.05, e[1] - 0.45 * Math.sign(e[1]) - ear * Math.sign(e[1]));
          ctx.lineTo(e[0] + 0.35, e[1]);
          ctx.closePath();
          ctx.fillStyle = '#0f9a8c';
          ctx.fill();
          ctx.strokeStyle = '#04322d';
          ctx.lineWidth = 0.1;
          ctx.stroke();
        });
        // голова
        ellipse(ctx, 0, 0, 1.02, 0.95);
        var g = ctx.createRadialGradient(-0.2, -0.3, 0.15, 0, 0, 1.15);
        g.addColorStop(0, '#e7fffb');
        g.addColorStop(0.55, '#4ee6d3');
        g.addColorStop(1, '#0b8377');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.13;
        ctx.strokeStyle = '#04322d';
        ctx.stroke();
        // глаза-неон
        ctx.save();
        ctx.shadowColor = '#b6fff4';
        ctx.shadowBlur = 0.6;
        eye(ctx, 0.3, -0.18, 0.19, '#083d37', '#6cffee');
        eye(ctx, 0.62, 0.22, 0.15, '#083d37', '#6cffee');
        ctx.restore();
        // усы
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 0.045;
        ctx.beginPath();
        ctx.moveTo(0.62, 0.5); ctx.lineTo(1.15, 0.38);
        ctx.moveTo(0.62, 0.56); ctx.lineTo(1.1, 0.62);
        ctx.stroke();
        ctx.restore();
      }
    },
    {
      id: 'ghost', texture: 'waves', name: 'Призрак', tag: 'дух',
      land: '#8fa6d8', land2: '#5a6f9e', edge: '#dfe9ff', trail: '#a9bdff',
      head: '#eef3ff', dark: '#232c44', accent: '#9ad7ff',
      draw: function (ctx, o) {
        var wav = Math.sin(o.t * 7) * 0.08;
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        ctx.arc(0, -0.15, 0.95, Math.PI, 0);
        ctx.lineTo(0.95, 0.45);
        ctx.quadraticCurveTo(0.6, 0.85 + wav, 0.3, 0.5);
        ctx.quadraticCurveTo(0, 0.95 - wav, -0.3, 0.5);
        ctx.quadraticCurveTo(-0.6, 0.85 + wav, -0.95, 0.45);
        ctx.closePath();
        var g = ctx.createLinearGradient(0, -1, 0, 0.9);
        g.addColorStop(0, 'rgba(255,255,255,0.98)');
        g.addColorStop(0.65, 'rgba(200,220,255,0.92)');
        g.addColorStop(1, 'rgba(140,165,215,0.75)');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.1;
        ctx.strokeStyle = 'rgba(90,110,160,0.5)';
        ctx.stroke();
        eye(ctx, 0.34, -0.16, 0.18, '#232c44');
        eye(ctx, 0.02, 0.14, 0.14, '#232c44');
        ctx.beginPath();
        ctx.ellipse(0.2, 0.42, 0.16, 0.1, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(35,44,68,0.55)';
        ctx.fill();
        ctx.restore();
      }
    }
  ];

  var byId = {};
  list.forEach(function (s) { byId[s.id] = s; });

  function skinById(id) { return byId[id] || list[0]; }

  /* Нарисовать персонажа в точке (x, y) мирового пространства. */
  function drawSkin(ctx, skin, x, y, angle, scale, opt) {
    var s = skinById(skin);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    // контактная тень
    ctx.beginPath();
    ctx.ellipse(0, 0.56, 0.92, 0.30, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(17,26,43,0.18)';
    ctx.fill();
    ctx.rotate(angle);
    s.draw(ctx, opt || { t: 0, move: 0 });
    ctx.restore();
  }

  PIO.SKINS = list;
  PIO.skinById = skinById;
  PIO.drawSkin = drawSkin;
  PIO.skinTools = { rr: rr, ellipse: ellipse, eye: eye, gloss: gloss };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SKINS: list, skinById: skinById, drawSkin: drawSkin };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
