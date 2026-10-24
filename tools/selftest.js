/* ============================================================================
 * selftest.js — интеграционная проверка живой игры в настоящем браузере:
 * настоящие кнопки, настоящий указатель (PointerEvent), настоящий канвас.
 * ==========================================================================*/
(function () {
  'use strict';
  window.__errs = window.__errs || [];
  var report = { ok: true, checks: [] };

  function check(name, pass, extra) {
    report.checks.push({ name: name, pass: !!pass, extra: extra === undefined ? null : extra });
    if (!pass) report.ok = false;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function key(code) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: code, key: code, bubbles: true }));
  }
  function publish() {
    report.viewport = { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 };
    report.totals = {
      pass: report.checks.filter(function (c) { return c.pass; }).length,
      all: report.checks.length
    };
    window.__SELFTEST_REPORT = report;
    var pre = document.createElement('pre');
    pre.id = 'selftest-report';
    pre.textContent = 'SELFTEST_JSON:' + JSON.stringify(report);
    document.body.appendChild(pre);
  }

  async function run() {
    var PZ = window.__PZ, PIO = window.PIO;
    var game = null;

    function alive() {
      return !!(PZ.game && PZ.game.human && PZ.game.human.alive && PZ.game.state === 'playing');
    }

    /* Навести указатель на мировую точку (мышь = курсор в стороне от головы). */
    function aimWorld(wx, wy) {
      var h = PZ.game.human;
      var head = PZ.renderer.worldToScreen(h.x, h.y);
      var t = PZ.renderer.worldToScreen(wx, wy);
      var dx = t.x - head.x, dy = t.y - head.y;
      var len = Math.hypot(dx, dy) || 1;
      var px = head.x + (dx / len) * 180;
      var py = head.y + (dy / len) * 180;
      window.dispatchEvent(new PointerEvent('pointermove', {
        pointerType: 'mouse', clientX: px, clientY: py, bubbles: true
      }));
    }

    async function aimUntil(cond, ms) {
      var t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (!alive()) return false;
        if (cond && cond()) return true;
        var p = PZ.game.human;
        var target = cond && cond.target ? cond.target(p) : null;
        if (target) aimWorld(target.x, target.y);
        await wait(40);
      }
      return false;
    }

    function ownBounds() {
      var grid = PZ.game.grid;
      var minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
      for (var y = 0; y < grid.h; y++) {
        for (var x = 0; x < grid.w; x++) {
          if (grid.owner[y * grid.w + x] !== 1) continue;
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
        }
      }
      return { cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, minx: minx, maxx: maxx, miny: miny, maxy: maxy };
    }

    function canvasStats() {
      var c = document.getElementById('field');
      var ctx = c.getContext('2d');
      var w = Math.floor(c.width / 2), h = Math.floor(c.height / 2);
      var img = ctx.getImageData(Math.floor(c.width / 4), Math.floor(c.height / 4), w, h);
      var colors = {}, land = 0, total = 0;
      var skin = PIO.skinById(PZ.game.human.skinId);
      var lr = PIO.hexToRgb(skin.land), er = PIO.hexToRgb(skin.edge);
      for (var i = 0; i < img.data.length; i += 64) {
        var r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
        colors[r + ',' + g + ',' + b] = 1;
        total++;
        var dl = Math.abs(r - lr[0]) + Math.abs(g - lr[1]) + Math.abs(b - lr[2]);
        var de = Math.abs(r - er[0]) + Math.abs(g - er[1]) + Math.abs(b - er[2]);
        if (dl < 80 || de < 80) land++;
      }
      return { colors: Object.keys(colors).length, land: land, total: total };
    }

    function menVisible() {
      return !document.getElementById('screen-menu').classList.contains('is-hidden');
    }

    async function freshMatch() {
      PZ.startMatch();
      await wait(420);
      return PZ.game;
    }

    /* ------------------------------- меню ------------------------------- */
    check('модули загружены', !!(PZ && PIO && PIO.Game && PIO.Renderer && PIO.UI && PIO.SKINS && PIO.drawSkin), Object.keys(PIO || {}));
    check('стартовый экран — меню', PZ.screen === 'menu' && menVisible(), PZ.screen);
    check('персонажей в меню: 10', document.querySelectorAll('.skin').length === 10, document.querySelectorAll('.skin').length);
    check('режимов: 4', document.querySelectorAll('.mode').length === 4, document.querySelectorAll('.mode').length);
    check('предпросмотр скина выбран', document.querySelector('.skin.is-active') !== null);
    check('демо-матч идёт за меню', !!(PZ.attract && PZ.attract.time > 0), PZ.attract ? +PZ.attract.time.toFixed(2) : null);

    var stage = document.getElementById('skin-stage');
    var sctx = stage.getContext('2d');
    var simg = sctx.getImageData(0, 0, stage.width, stage.height).data;
    var opaque = 0;
    for (var si = 3; si < simg.length; si += 160) if (simg[si] > 20) opaque++;
    check('сцена рисует персонажа', opaque > 40, opaque);

    /* смена скина */
    var beforeSkin = PZ.save.skinId;
    var other = Array.prototype.filter.call(document.querySelectorAll('.skin'), function (b) {
      return b.getAttribute('data-skin') !== beforeSkin;
    })[0];
    other.click();
    await wait(150);
    check('скин переключается и сохраняется', PZ.save.skinId !== beforeSkin && PZ.save.skinId === other.getAttribute('data-skin'), PZ.save.skinId);
    check('имя скина обновилось', document.getElementById('skin-name').textContent.length > 1,
      document.getElementById('skin-name').textContent);

    /* режим: свободная игра показывает настройки */
    document.querySelector('.mode[data-mode="free"]').click();
    await wait(60);
    check('свободная игра выбрана', document.querySelector('.mode[data-mode="free"]').classList.contains('is-active'));
    var botsInput = document.getElementById('opt-bots');
    botsInput.value = '0';
    botsInput.dispatchEvent(new Event('input'));
    await wait(60);
    check('ползунок ботов применяется', PZ.save.botCount === 0, PZ.save.botCount);

    /* ---------------------------- матч ---------------------------- */
    game = await freshMatch();
    check('матч стартовал', PZ.screen === 'game' && !!game, PZ.screen);
    check('HUD виден', !document.getElementById('hud').classList.contains('is-hidden'));
    check('свободная игра без ботов', game.players.length === 1, game.players.length);
    check('HUD показывает процент', /^\d+\.\d%$/.test(document.getElementById('hud-percent').textContent),
      document.getElementById('hud-percent').textContent);
    check('таблица лидеров заполнена', document.querySelectorAll('#board li').length >= 1,
      document.querySelectorAll('#board li').length);

    var cs = canvasStats();
    check('на канвасе есть отрисовка', cs.colors > 8, { colors: cs.colors });
    check('земля игрока видна на канвасе', cs.land > 60, { land: cs.land, samples: cs.total });

    /* ------------------------- аналоговое управление ------------------ */
    var p = game.human;
    var a0 = p.angle;
    var startX = p.x, startY = p.y;
    aimWorld(p.x + 40, p.y);
    await wait(450);
    check('курс следует за указателем вправо', Math.abs(PIO.angNorm(p.angle - 0)) < 0.35, +p.angle.toFixed(2));
    aimWorld(p.x, p.y - 40);
    await wait(700);
    check('курс поворачивает вверх', Math.abs(PIO.angNorm(p.angle + Math.PI / 2)) < 0.4, +p.angle.toFixed(2));
    aimWorld(p.x + 40, p.y - 40);
    await wait(700);
    check('диагональный курс работает', Math.abs(PIO.angNorm(p.angle + Math.PI / 4)) < 0.4, +p.angle.toFixed(2));

    var moved = Math.hypot(p.x - startX, p.y - startY);
    check('персонаж реально едет', moved > 4, +moved.toFixed(1));

    /* ------------------------------ захват ---------------------------- */
    var before = game.grid.percent(1);

    /* Ведём указателем по прямоугольнику вокруг своей земли, затем на центр:
     * детерминированная петля без самопересечения. */
    async function loopOnce() {
      var b = ownBounds();
      var r = b.maxx + 10, l = Math.max(6, b.minx - 10);
      var bt = b.maxy + 10, tp = b.cy;
      var legs = [[r, tp], [r, bt], [l, bt], [l, tp], [b.cx, b.cy]];
      for (var i = 0; i < legs.length; i++) {
        var t0 = Date.now();
        while (Date.now() - t0 < 6000) {
          if (!alive()) return false;
          var p = game.human;
          if (game.human.trail.size === 0 && i === legs.length - 1) return true;
          var dx = legs[i][0] - p.x, dy = legs[i][1] - p.y;
          if (Math.hypot(dx, dy) < 4 && i < legs.length - 1) break;
          aimWorld(legs[i][0], legs[i][1]);
          await wait(40);
        }
      }
      var t1 = Date.now();
      while (Date.now() - t1 < 3000 && alive() && game.human.trail.size > 0) {
        aimWorld(b.cx, b.cy);
        await wait(40);
      }
      return alive() && game.human.trail.size === 0;
    }

    var okLoop = await loopOnce();
    var after = game.grid.percent(1);
    if (!okLoop || after <= before + 0.05) {
      game = await freshMatch();
      before = game.grid.percent(1);
      okLoop = await loopOnce();
      after = game.grid.percent(1);
    }
    check('контур замкнулся и площадь выросла', alive() && after > before + 0.05,
      { before: +before.toFixed(2), after: +after.toFixed(2), trail: game.human.trail.size });
    check('след очищен после захвата', game.human.trail.size === 0, game.human.trail.size);
    check('эффект захвата отрисован', (PZ.renderer.captureCount || 0) > 0, PZ.renderer.captureCount || 0);
    check('HUD показывает выросший процент', parseFloat(document.getElementById('hud-percent').textContent) >= before - 0.01,
      document.getElementById('hud-percent').textContent);

    /* ------------------------------ пауза ----------------------------- */
    key('Escape');
    await wait(150);
    check('Escape ставит на паузу', PZ.screen === 'pause' &&
      !document.getElementById('screen-pause').classList.contains('is-hidden'), PZ.screen);
    var tPause = PZ.game.time;
    await wait(300);
    check('на паузе время не идёт', Math.abs(PZ.game.time - tPause) < 1e-9, [+tPause.toFixed(2), +PZ.game.time.toFixed(2)]);
    check('в паузе показан режим', document.getElementById('pause-info').textContent.indexOf('Свободная') === 0,
      document.getElementById('pause-info').textContent);
    document.getElementById('btn-resume').click();
    await wait(150);
    check('продолжение возвращает в игру', PZ.screen === 'game', PZ.screen);

    /* ---------------------------- настройки --------------------------- */
    if (PZ.screen !== 'game') game = await freshMatch();
    PZ.handleUI('pause');
    await wait(120);
    document.getElementById('btn-settings-pause').click();
    await wait(150);
    check('настройки открываются из паузы', PZ.screen === 'settings', PZ.screen);
    var soundBefore = PZ.save.settings.sound;
    var sbox = document.getElementById('set-sound');
    sbox.checked = !sbox.checked;
    sbox.dispatchEvent(new Event('change'));
    await wait(80);
    check('настройка звука сохраняется', PZ.save.settings.sound === !soundBefore, PZ.save.settings.sound);
    sbox.checked = soundBefore;
    sbox.dispatchEvent(new Event('change'));
    document.getElementById('btn-settings-back').click();
    await wait(180);
    check('из настроек возврат в паузу', PZ.screen === 'pause', PZ.screen);
    document.getElementById('btn-resume').click();
    await wait(150);
    check('после настроек матч идёт', PZ.screen === 'game' && PZ.game.state === 'playing', PZ.screen);

    /* --------------------------- результат ---------------------------- */
    if (!PZ.game || !PZ.game.human.alive || PZ.game.state !== 'playing') game = await freshMatch();
    var matchesBefore = PZ.save.matches;
    PZ.game.kill(PZ.game.human, 'test');
    for (var wr = 0; wr < 60 && PZ.screen !== 'result'; wr++) await wait(50);
    check('смерть открывает результат', PZ.screen === 'result' &&
      !document.getElementById('screen-result').classList.contains('is-hidden'), PZ.debug());
    check('экран результата заполнен', document.querySelectorAll('#result-grid .stat').length === 6,
      document.querySelectorAll('#result-grid .stat').length);
    var cells = Array.prototype.map.call(document.querySelectorAll('#result-grid .stat b'), function (n) { return n.textContent; });
    check('значения результата не пустые', cells.every(function (v) { return v && v.length; }), cells);
    check('процент совпадает с моделью', cells[0] === PZ.game.grid.percent(1).toFixed(1) + '%', cells[0]);
    check('матч записан в статистику', PZ.save.matches === matchesBefore + 1, { before: matchesBefore, after: PZ.save.matches });
    check('сохранение читается обратно', PIO.Storage.load().matches === PZ.save.matches);

    document.getElementById('btn-again').click();
    await wait(450);
    check('повторная игра запускает матч', PZ.screen === 'game' && PZ.game.time < 2.5,
      PZ.game ? +PZ.game.time.toFixed(2) : null);

    /* ------------------- классика: боты и живой матч ------------------- */
    document.getElementById('btn-menu-result').click();
    await wait(350);
    document.querySelector('.mode[data-mode="classic"]').click();
    await wait(80);
    document.getElementById('btn-play').click();
    await wait(1200);
    var botList = [], activeBots = 0;
    for (var waitBots = 0; waitBots < 40; waitBots++) {
      botList = PZ.game.aliveBots();
      activeBots = botList.filter(function (b) { return b.trail.size > 0; }).length;
      if (PZ.game.players.length === 6 && activeBots >= 2) break;
      await wait(150);
    }
    check('в классике 6 игроков', PZ.game.players.length === 6, PZ.game.players.length);
    check('боты живы и тянут след', botList.length >= 4 && activeBots >= 2,
      { bots: botList.length, withTrail: activeBots });
    check('таблица лидеров показывает несколько игроков', document.querySelectorAll('#board li').length >= 2,
      document.querySelectorAll('#board li').length);
    var hudBots = document.getElementById('hud-bots').textContent;
    check('HUD считает соперников', /\d+ соперник/.test(hudBots), hudBots);
    PZ.handleUI('pause');
    await wait(100);
    document.getElementById('btn-menu-pause').click();
    await wait(400);
    check('выход в меню из классики', PZ.screen === 'menu', PZ.screen);

    /* ------------------------- меню и рекорды ------------------------- */
    PZ.handleUI('pause');
    await wait(100);
    document.getElementById('btn-menu-pause').click();
    await wait(400);
    check('возврат в меню работает', PZ.screen === 'menu', PZ.screen);
    check('демо-матч перезапущен', !!(PZ.attract && PZ.attract.time > 0), PZ.attract ? +PZ.attract.time.toFixed(2) : null);

    PZ.handleUI('nav', 'stats');
    await wait(150);
    check('экран рекордов открывается', PZ.screen === 'stats', PZ.screen);
    check('рекорды заполнены', document.querySelectorAll('#stats-grid .stat').length === 8,
      document.querySelectorAll('#stats-grid .stat').length);
    document.querySelector('#screen-stats [data-screen="menu"]').click();
    await wait(180);
    check('возврат из рекордов', PZ.screen === 'menu', PZ.screen);

    /* ---------------------------- вёрстка ----------------------------- */
    var de = document.documentElement;
    check('нет горизонтальной прокрутки', de.scrollWidth <= window.innerWidth + 1,
      { scrollWidth: de.scrollWidth, innerWidth: window.innerWidth });
    var card = document.querySelector('#screen-menu .panel');
    var rect = card.getBoundingClientRect();
    check('панели меню в пределах экрана', rect.left >= -1 && rect.right <= window.innerWidth + 1,
      { left: Math.round(rect.left), right: Math.round(rect.right), w: window.innerWidth });
    var playRect = document.getElementById('btn-play').getBoundingClientRect();
    check('кнопка «Играть» крупная', playRect.height >= 44 && playRect.width >= 100,
      { h: Math.round(playRect.height), w: Math.round(playRect.width) });
    check('нет JS-ошибок', window.__errs.length === 0, window.__errs.slice(0, 5));

    publish();
  }

  window.addEventListener('load', function () {
    setTimeout(function () {
      run().catch(function (err) {
        report.ok = false;
        report.fatal = String((err && err.stack) || err);
        publish();
      });
    }, 700);
  });
})();
