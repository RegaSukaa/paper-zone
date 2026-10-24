/* ============================================================================
 * ui.js — экраны, меню выбора персонажа, HUD, настройки, результаты.
 * Только DOM и отрисовка превью: игровая логика живёт в engine.js.
 * ==========================================================================*/
(function (root) {
  'use strict';

  var PIO = root.PIO;
  var MODE_INFO = PIO.MODE_INFO;
  var MODE_ORDER = ['classic', 'survival', 'quick', 'free'];
  var LEVEL_NAMES = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный' };
  var LEVEL_HINTS = {
    easy: 'Боты осторожны: короткие вылазки, редкие атаки.',
    medium: 'Боты расширяются, замечают чужой след и атакуют.',
    hard: 'Длинные захваты, активная охота, быстрые решения.'
  };

  var UI = {
    on: null,
    skin: 'mint',
    stageCtx: null,
    cardCtx: {},
    menuVisible: true,
    t: 0,
    _lastDraw: 0,

    init: function (handlers) {
      this.on = handlers.on;
      this.build();
      this.wire();
      this.stageCtx = document.getElementById('skin-stage').getContext('2d');
      this.animate(0, true);
    },

    /* ------------------------------ построение ------------------------- */

    build: function () {
      var self = this;
      document.getElementById('mode-list').innerHTML = MODE_ORDER.map(function (m) {
        var info = MODE_INFO[m];
        return '<button type="button" class="mode" data-mode="' + m + '">' +
          '<b>' + info.title + '</b><span>' + info.desc + '</span></button>';
      }).join('');

      var list = document.getElementById('skin-list');
      list.innerHTML = PIO.SKINS.map(function (s) {
        return '<button type="button" class="skin" data-skin="' + s.id + '" title="' + s.name + '" role="option">' +
          '<canvas width="96" height="96"></canvas></button>';
      }).join('');

      Array.prototype.forEach.call(list.querySelectorAll('.skin'), function (btn) {
        var id = btn.getAttribute('data-skin');
        var cv = btn.querySelector('canvas');
        self.cardCtx[id] = cv.getContext('2d');
      });

      document.getElementById('btn-play').addEventListener('click', function () { self.on && self.on('play'); });
      document.getElementById('btn-pause').addEventListener('click', function () { self.on && self.on('pause'); });
      document.getElementById('btn-resume').addEventListener('click', function () { self.on && self.on('resume'); });
      document.getElementById('btn-restart-pause').addEventListener('click', function () { self.on && self.on('restart'); });
      document.getElementById('btn-settings-pause').addEventListener('click', function () { self.on && self.on('settingsOpen'); });
      document.getElementById('btn-menu-pause').addEventListener('click', function () { self.on && self.on('menu'); });
      document.getElementById('btn-again').addEventListener('click', function () { self.on && self.on('again'); });
      document.getElementById('btn-menu-result').addEventListener('click', function () { self.on && self.on('menu'); });
      document.getElementById('btn-settings-back').addEventListener('click', function () { self.on && self.on('settingsBack'); });
      document.getElementById('btn-reset').addEventListener('click', function () { self.on && self.on('reset'); });

      ['opt-bots', 'opt-speed', 'opt-size'].forEach(function (id) {
        document.getElementById(id).addEventListener(id === 'opt-size' ? 'change' : 'input', function () { self.emitFree(); });
      });
      ['set-sound', 'set-minimap', 'set-shake'].forEach(function (id) {
        document.getElementById(id).addEventListener('change', function () { self.emitSettings(); });
      });
      document.getElementById('set-volume').addEventListener('input', function () { self.emitSettings(); });
    },

    wire: function () {
      var self = this;
      document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('button');
        if (btn && !btn.disabled && self.on) self.on('click');

        var mode = e.target.closest && e.target.closest('.mode');
        if (mode && self.on) self.on('mode', mode.getAttribute('data-mode'));

        var skin = e.target.closest && e.target.closest('.skin');
        if (skin && self.on) self.on('skin', skin.getAttribute('data-skin'));

        var diff = e.target.closest && e.target.closest('#difficulty-list button');
        if (diff && self.on) self.on('difficulty', diff.getAttribute('data-difficulty'));

        var nav = e.target.closest && e.target.closest('button[data-screen]');
        if (nav && self.on) self.on('nav', nav.getAttribute('data-screen'));
      });
    },

    emitSettings: function () {
      if (!this.on) return;
      var volume = Number(document.getElementById('set-volume').value) / 100;
      document.getElementById('set-volume-value').textContent = Math.round(volume * 100) + '%';
      this.on('settings', {
        sound: document.getElementById('set-sound').checked,
        volume: volume,
        minimap: document.getElementById('set-minimap').checked,
        shake: document.getElementById('set-shake').checked
      });
    },

    emitFree: function () {
      if (!this.on) return;
      var bots = Number(document.getElementById('opt-bots').value);
      var speed = Number(document.getElementById('opt-speed').value);
      document.getElementById('opt-bots-value').textContent = bots;
      document.getElementById('opt-speed-value').textContent = speed;
      this.on('free', {
        botCount: bots,
        mapSize: document.getElementById('opt-size').value,
        speed: speed
      });
    },

    /* -------------------------------- превью --------------------------- */

    animate: function (now, force) {
      if (!this.stageCtx) return;
      // ~24 кадра в секунду достаточно и не грузит процессор в меню
      if (!force && now - this._lastDraw < 42) return;
      var dt = this._lastDraw ? Math.min(0.1, (now - this._lastDraw) / 1000) : 0.016;
      this._lastDraw = now;
      this.t += dt;
      if (!this.menuVisible) return;

      var t = this.t;

      // большая сцена: персонаж едет по кругу, оставляя след
      var cv = document.getElementById('skin-stage');
      var ctx = this.stageCtx;
      var W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      var cx = W / 2, cy = H / 2 + 6;
      var R = Math.min(W, H) * 0.28;
      var ang = t * 0.9;
      var px = cx + Math.cos(ang) * R;
      var py = cy + Math.sin(ang) * R;

      // пунктирная орбита
      ctx.save();
      ctx.setLineDash([4, 9]);
      ctx.strokeStyle = 'rgba(27,36,54,0.10)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // след за персонажем
      var skin = PIO.skinById(this.skin);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, ang - 1.9, ang, false);
      ctx.strokeStyle = skin.trail;
      ctx.lineWidth = Math.min(W, H) * 0.045;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.min(W, H) * 0.016;
      ctx.stroke();
      ctx.restore();

      // сам персонаж
      var scale = Math.min(W, H) / 150;
      PIO.drawSkin(ctx, skin.id, px, py, ang + Math.PI / 2, scale * 1.15, {
        t: t, move: 1, squash: Math.max(0, Math.sin(t * 6)) * 0.4
      });

      // карточки скинов
      for (var id in this.cardCtx) {
        var c2 = this.cardCtx[id];
        var canvas = c2.canvas;
        c2.clearRect(0, 0, canvas.width, canvas.height);
        PIO.drawSkin(c2, id, canvas.width / 2, canvas.height / 2 + 4, 0.32,
          canvas.width / 4.1, { t: t + id.length, move: 0.7, squash: 0.15 });
      }
    },

    setSkin: function (id) {
      this.skin = id;
      var def = PIO.skinById(id);
      document.getElementById('skin-name').textContent = def.name;
      document.getElementById('skin-tag').textContent = def.tag;
      Array.prototype.forEach.call(document.querySelectorAll('.skin'), function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-skin') === id);
      });
      this.animate(performance.now(), true);
    },

    /* -------------------------------- экраны --------------------------- */

    show: function (name) {
      ['menu', 'help', 'stats', 'settings', 'pause', 'result'].forEach(function (n) {
        var node = document.getElementById('screen-' + n);
        if (node) node.classList.toggle('is-hidden', n !== name);
      });
      var hud = document.getElementById('hud');
      if (hud) hud.classList.toggle('is-hidden', name !== 'game');
      document.body.setAttribute('data-view', name);
      this.menuVisible = name === 'menu';
      if (this.menuVisible) this.animate(performance.now(), true);
    },

    syncMenu: function (cfg) {
      Array.prototype.forEach.call(document.querySelectorAll('.mode'), function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-mode') === cfg.mode);
      });
      Array.prototype.forEach.call(document.querySelectorAll('#difficulty-list button'), function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-difficulty') === cfg.difficulty);
      });
      document.getElementById('difficulty-hint').textContent = LEVEL_HINTS[cfg.difficulty] || '';
      this.setSkin(cfg.skinId);
      document.getElementById('opt-bots').value = String(cfg.botCount);
      document.getElementById('opt-bots-value').textContent = cfg.botCount;
      document.getElementById('opt-size').value = cfg.mapSize;
      document.getElementById('opt-speed').value = String(cfg.speed);
      document.getElementById('opt-speed-value').textContent = cfg.speed;
      document.getElementById('free-options').style.opacity = cfg.mode === 'free' ? '1' : '0.45';
    },

    syncSettings: function (s) {
      document.getElementById('set-sound').checked = !!s.sound;
      document.getElementById('set-minimap').checked = !!s.minimap;
      document.getElementById('set-shake').checked = !!s.shake;
      document.getElementById('set-volume').value = String(Math.round(s.volume * 100));
      document.getElementById('set-volume-value').textContent = Math.round(s.volume * 100) + '%';
    },

    renderStats: function (save) {
      var rate = save.matches ? Math.round((save.wins / save.matches) * 100) : 0;
      var rows = [
        ['Матчей', String(save.matches)],
        ['Побед', String(save.wins)],
        ['Поражений', String(save.losses)],
        ['Доля побед', rate + '%'],
        ['Лучший процент', save.bestPercent.toFixed(1) + '%'],
        ['Лучший счёт', String(save.bestScore)],
        ['Уничтожено ботов', String(save.kills)],
        ['Лучшее выживание', formatTime(save.bestSurvival)]
      ];
      document.getElementById('stats-grid').innerHTML = rows.map(function (r) {
        return '<div class="stat"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>';
      }).join('');
    },

    setPauseInfo: function (game) {
      var info = MODE_INFO[game.mode] ? MODE_INFO[game.mode].title : '';
      document.getElementById('pause-info').textContent =
        info + ' · ' + (LEVEL_NAMES[game.difficulty] || '') + ' · ' + formatTime(game.time);
    },

    /* --------------------------------- HUD ----------------------------- */

    updateHUD: function (game) {
      var st = game.stats();
      setText('hud-percent', st.percent.toFixed(1) + '%');
      setText('hud-cells', st.cells + ' ' + plural(st.cells, 'клетка', 'клетки', 'клеток'));
      var time = game.rules.timeLimit ? Math.max(0, game.rules.timeLimit - game.time) : game.time;
      setText('hud-time', formatTime(time));
      setText('hud-mode', (MODE_INFO[game.mode] || {}).title || '');
      setText('hud-bots', st.botsAlive + ' ' + plural(st.botsAlive, 'соперник', 'соперника', 'соперников'));
      setText('hud-score', String(st.score));
      setText('hud-leader', 'лидер ' + st.bestBotPercent.toFixed(1) + '%');

      var goal = game.rules.goalPercent || 0;
      var bar = document.getElementById('hud-progress');
      if (bar) {
        var pct = goal ? Math.min(100, (st.percent / goal) * 100) : Math.min(100, st.percent * 2);
        bar.style.width = pct.toFixed(1) + '%';
      }

      // таблица лидеров: топ-3 по территории + игрок
      var sorted = game.players.slice().filter(function (p) { return p.alive; }).sort(function (a, b) {
        return game.grid.ownerCount(b.id) - game.grid.ownerCount(a.id);
      });
      var top = sorted.slice(0, 3);
      var me = game.players[0];
      if (me && me.alive && top.indexOf(me) === -1) top.push(me);
      var board = document.getElementById('board');
      var html = top.map(function (p) {
        var cells = game.grid.ownerCount(p.id);
        return '<li class="' + (p.id === 1 ? 'is-me' : '') + '">' +
          '<i style="background:' + p.palette.land + '"></i>' +
          '<span>' + (p.id === 1 ? 'Ты' : p.name) + '</span>' +
          '<b>' + game.grid.percent(p.id).toFixed(1) + '%</b></li>';
      }).join('');
      if (board.innerHTML !== html) board.innerHTML = html;
    },

    /* ------------------------------- результат ------------------------- */

    showResult: function (result, rec, bestScore) {
      var badge = document.getElementById('result-badge');
      badge.textContent = result.win ? 'Победа' : 'Поражение';
      badge.classList.toggle('badge--lose', !result.win);

      var titles = {
        goal: 'Цель по территории взята',
        survived: 'Полоса выживания пройдена',
        time: result.win ? 'Время вышло — ты впереди' : 'Время вышло',
        died: 'Хвост перерезали',
        wall: 'Врезался в край карты',
        head: 'Лобовое столкновение'
      };
      document.getElementById('result-title').textContent =
        titles[result.reason] || (result.win ? 'Победа' : 'Матч проигран');

      var reasons = {
        goal: 'Захвачено ' + result.percent.toFixed(1) + '% карты — цель выполнена.',
        survived: 'Ты продержался ' + formatTime(result.time) + ' при растущем давлении.',
        time: 'Твоя территория ' + result.percent.toFixed(1) + '%, у лидера ' + result.bestBotPercent.toFixed(1) + '%.',
        died: 'Соперник пересёк твой след на открытой земле.',
        wall: 'Граница карты смертельна.',
        head: 'Ты столкнулся с соперником вне своей земли.'
      };
      document.getElementById('result-reason').textContent = reasons[result.reason] || 'Матч завершён.';

      var rows = [
        ['Территория', result.percent.toFixed(1) + '%'],
        ['Клеток', String(result.cells)],
        ['Время', formatTime(result.time)],
        ['Уничтожено', String(result.kills)],
        ['Счёт', String(result.score)],
        ['Рекорд', rec && rec.bestScore ? 'новый!' : String(bestScore || 0)]
      ];
      document.getElementById('result-grid').innerHTML = rows.map(function (r) {
        return '<div class="stat"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>';
      }).join('');

      this.show('result');
    },

    toast: function (text, ms) {
      var node = document.getElementById('toast');
      node.textContent = text;
      node.classList.remove('is-hidden');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(function () { node.classList.add('is-hidden'); }, ms || 2200);
    }
  };

  function setText(id, text) {
    var node = document.getElementById(id);
    if (node && node.textContent !== text) node.textContent = text;
  }

  function plural(n, one, few, many) {
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
    return many;
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  root.PIO = root.PIO || {};
  root.PIO.UI = UI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
