/* ============================================================================
 * ui.js — экраны, меню, HUD, настройки, результаты. Никакой игровой логики,
 * только DOM и отображение реальных данных из модели.
 * ==========================================================================*/
(function (root) {
  'use strict';

  var PIO = root.PIO;
  var SKINS = PIO.SKINS;
  var MODE_INFO = PIO.MODE_INFO;

  var LEVEL_NAMES = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный' };
  var LEVEL_HINTS = {
    easy: 'Боты осторожны: короткие вылазки, редкие атаки.',
    medium: 'Боты расширяются, замечают чужой след и атакуют.',
    hard: 'Длинные захваты, активная охота и быстрые решения.'
  };
  var MODE_ORDER = ['classic', 'survival', 'quick', 'free'];

  var UI = {
    on: null,

    init: function (handlers) {
      this.on = handlers.on;
      this.build();
      this.wire();
    },

    /* ------------------------------ построение ------------------------- */

    build: function () {
      var self = this;

      var modeList = document.getElementById('mode-list');
      modeList.innerHTML = MODE_ORDER.map(function (m) {
        var info = MODE_INFO[m];
        return '<button type="button" class="mode" data-mode="' + m + '">' +
          '<b>' + info.title + '</b><span>' + info.desc + '</span></button>';
      }).join('');

      var skinList = document.getElementById('skin-list');
      skinList.innerHTML = SKINS.map(function (s, i) {
        return '<button type="button" class="skin" data-skin="' + i + '" title="' + s.name + '" ' +
          'style="background:linear-gradient(135deg,' + s.edge + ',' + s.land + ')"></button>';
      }).join('');

      var botsRange = document.getElementById('opt-bots');
      var speedRange = document.getElementById('opt-speed');
      botsRange.addEventListener('input', function () {
        self.emitFree();
      });
      speedRange.addEventListener('input', function () {
        self.emitFree();
      });
      document.getElementById('opt-size').addEventListener('change', function () {
        self.emitFree();
      });

      document.getElementById('btn-play').addEventListener('click', function () {
        self.on && self.on('play');
      });
      document.getElementById('btn-pause').addEventListener('click', function () {
        self.on && self.on('pause');
      });
      document.getElementById('btn-resume').addEventListener('click', function () {
        self.on && self.on('resume');
      });
      document.getElementById('btn-restart-pause').addEventListener('click', function () {
        self.on && self.on('restart');
      });
      document.getElementById('btn-settings-pause').addEventListener('click', function () {
        self.on && self.on('settingsOpen');
      });
      document.getElementById('btn-menu-pause').addEventListener('click', function () {
        self.on && self.on('menu');
      });
      document.getElementById('btn-again').addEventListener('click', function () {
        self.on && self.on('again');
      });
      document.getElementById('btn-menu-result').addEventListener('click', function () {
        self.on && self.on('menu');
      });
      document.getElementById('btn-settings-back').addEventListener('click', function () {
        self.on && self.on('settingsBack');
      });
      document.getElementById('btn-reset').addEventListener('click', function () {
        self.on && self.on('reset');
      });

      ['set-sound', 'set-volume', 'set-minimap', 'set-shake'].forEach(function (id) {
        var node = document.getElementById(id);
        node.addEventListener(id === 'set-sound' || id === 'set-minimap' || id === 'set-shake' ? 'change' : 'input', function () {
          self.emitSettings();
        });
      });
    },

    wire: function () {
      var self = this;
      document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('button');
        if (btn && !btn.disabled && self.on) self.on('click');

        var modeBtn = e.target.closest && e.target.closest('.mode');
        if (modeBtn && self.on) self.on('mode', modeBtn.getAttribute('data-mode'));

        var skinBtn = e.target.closest && e.target.closest('.skin');
        if (skinBtn && self.on) self.on('skin', Number(skinBtn.getAttribute('data-skin')));

        var diffBtn = e.target.closest && e.target.closest('#difficulty-list button');
        if (diffBtn && self.on) self.on('difficulty', diffBtn.getAttribute('data-difficulty'));

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

    /* -------------------------------- экраны --------------------------- */

    show: function (name) {
      ['menu', 'help', 'stats', 'settings', 'pause', 'result'].forEach(function (n) {
        var node = document.getElementById('screen-' + n);
        if (node) node.classList.toggle('is-hidden', n !== name);
      });
      var hud = document.getElementById('hud');
      if (hud) hud.classList.toggle('is-hidden', name !== 'game');
      document.body.setAttribute('data-view', name);
    },

    syncMenu: function (cfg) {
      var self = this;
      Array.prototype.forEach.call(document.querySelectorAll('.mode'), function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-mode') === cfg.mode);
      });
      Array.prototype.forEach.call(document.querySelectorAll('#difficulty-list button'), function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-difficulty') === cfg.difficulty);
      });
      Array.prototype.forEach.call(document.querySelectorAll('.skin'), function (b) {
        b.classList.toggle('is-active', Number(b.getAttribute('data-skin')) === cfg.skin);
      });
      document.getElementById('difficulty-hint').textContent = LEVEL_HINTS[cfg.difficulty] || '';
      document.getElementById('skin-name').textContent = (SKINS[cfg.skin] || SKINS[0]).name;

      var free = document.getElementById('free-options');
      free.classList.toggle('is-hidden', cfg.mode !== 'free');
      document.getElementById('opt-bots').value = String(cfg.botCount);
      document.getElementById('opt-bots-value').textContent = cfg.botCount;
      document.getElementById('opt-size').value = cfg.mapSize;
      document.getElementById('opt-speed').value = String(cfg.speed);
      document.getElementById('opt-speed-value').textContent = cfg.speed;
    },

    syncSettings: function (s) {
      document.getElementById('set-sound').checked = !!s.sound;
      document.getElementById('set-minimap').checked = !!s.minimap;
      document.getElementById('set-shake').checked = !!s.shake;
      document.getElementById('set-volume').value = String(Math.round(s.volume * 100));
      document.getElementById('set-volume-value').textContent = Math.round(s.volume * 100) + '%';
    },

    renderStats: function (save) {
      var winRate = save.matches ? Math.round((save.wins / save.matches) * 100) : 0;
      var rows = [
        ['Матчей', String(save.matches)],
        ['Побед', String(save.wins)],
        ['Поражений', String(save.losses)],
        ['Доля побед', winRate + '%'],
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
    },

    /* ------------------------------- результат ------------------------- */

    showResult: function (result, rec, bestScore) {
      var badge = document.getElementById('result-badge');
      var title = document.getElementById('result-title');
      var reason = document.getElementById('result-reason');
      badge.textContent = result.win ? 'Победа' : 'Поражение';
      badge.classList.toggle('result__badge--lose', !result.win);

      var titles = {
        goal: 'Цель по территории взята',
        lastman: 'Все соперники уничтожены',
        survived: 'Ты выжил',
        time: result.win ? 'Время вышло — ты впереди' : 'Время вышло',
        died: 'Хвост перерезали',
        wall: 'Врезался в край карты',
        head: 'Лобовое столкновение',
        swap: 'Лобовое столкновение'
      };
      title.textContent = titles[result.reason] || (result.win ? 'Победа' : 'Матч проигран');

      var reasons = {
        goal: 'Захвачено ' + result.percent.toFixed(1) + '% карты — цель выполнена.',
        lastman: 'Территория ' + result.percent.toFixed(1) + '%, соперников не осталось.',
        survived: 'Ты продержался ' + formatTime(result.time) + ' при растущем давлении.',
        time: 'Твоя территория ' + result.percent.toFixed(1) + '%, у лидера ' + result.bestBotPercent.toFixed(1) + '%.',
        died: 'Соперник пересёк твой след. Территория осталась у тебя в статистике.',
        wall: 'Граница карты смертельна: выходить за неё нельзя.',
        head: 'Вы с соперником столкнулись лоб в лоб вне своей земли.',
        swap: 'Вы с соперником столкнулись лоб в лоб вне своей земли.'
      };
      reason.textContent = reasons[result.reason] || 'Матч завершён.';

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
      this._toastTimer = setTimeout(function () {
        node.classList.add('is-hidden');
      }, ms || 2200);
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
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  root.PIO = root.PIO || {};
  root.PIO.UI = UI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
