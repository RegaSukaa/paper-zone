/* ============================================================================
 * selftest.js — интеграционная проверка живой игры в настоящем браузере.
 * Вставляется в копию index.html (tools/headless-check.js), кликает по реальным
 * кнопкам, ведёт персонажа клавиатурой и печатает отчёт в <pre>.
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
  async function steerUntil(code, cond, ms) {
    key(code);
    var t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await wait(25);
      if (cond()) return true;
    }
    return false;
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
    var g = null;

    function alive() {
      return !!(PZ.game && PZ.game.human && PZ.game.human.alive && PZ.game.state === 'playing');
    }

    /* Проверка отрисовки: ищем на канвасе пиксели цвета земли игрока. */
    function canvasStats() {
      var c = document.getElementById('field');
      var ctx = c.getContext('2d');
      var w = Math.floor(c.width / 2), h = Math.floor(c.height / 2);
      var img = ctx.getImageData(Math.floor(c.width / 4), Math.floor(c.height / 4), w, h);
      var colors = {}, bright = 0, land = 0, total = 0;
      var skin = PIO.SKINS[(PZ.game.human.skin || 0) % PIO.SKINS.length];
      var landRgb = PIO.hexToRgb(skin.land);
      var edgeRgb = PIO.hexToRgb(skin.edge);
      for (var i = 0; i < img.data.length; i += 64) {
        var r = img.data[i], gg = img.data[i + 1], b = img.data[i + 2];
        colors[r + ',' + gg + ',' + b] = 1;
        total++;
        if (r + gg + b > 90) bright++;
        var dl = Math.abs(r - landRgb[0]) + Math.abs(gg - landRgb[1]) + Math.abs(b - landRgb[2]);
        var de = Math.abs(r - edgeRgb[0]) + Math.abs(gg - edgeRgb[1]) + Math.abs(b - edgeRgb[2]);
        if (dl < 70 || de < 70) land++;
      }
      return { colors: Object.keys(colors).length, bright: bright / total, land: land, samples: total };
    }

    /* Границы своей территории: от них строим петлю, чтобы она гарантированно
     * замкнулась именно о свою землю, а не улетела в никуда. */
    function early(before) {
      var h = PZ.game.human;
      return { ok: false, died: true, before: +before.toFixed(2), cause: h.deathCause,
               at: [h.cx, h.cy], box: ownBounds() };
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
      return {
        minx: minx, miny: miny, maxx: maxx, maxy: maxy,
        cx: Math.round((minx + maxx) / 2), cy: Math.round((miny + maxy) / 2)
      };
    }

    async function driveUntil(tx, ty, cond, ms) {
      var t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (!alive()) return false;
        if (cond && cond()) return true;
        var p = PZ.game.human;
        var dx = tx - p.cx, dy = ty - p.cy;
        // допуск в одну клетку: шаг симуляции крупнее клетки, иначе игрок
        // «перелетает» цель и разворачивается назад, в свой же след
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return true;
        key(Math.abs(dx) >= Math.abs(dy)
          ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft')
          : (dy > 0 ? 'ArrowDown' : 'ArrowUp'));
        await wait(50);
      }
      return false;
    }

    /* Квадратная петля вокруг своей земли: вправо — вниз — влево — вверх —
     * вправо в свою клетку. Возврат закрывает контур в реальном движении. */
    async function tryCapture() {
      var before = PZ.game.grid.percent(1);
      var b = ownBounds();
      if (b.maxx < 0) return { ok: false, died: !alive(), before: before };
      var startX = PZ.game.human.cx, startY = PZ.game.human.cy;
      // цели не должны оказаться позади игрока: иначе первый шаг пойдёт назад,
      // прямо по своему же следу
      var right = Math.max(b.maxx + 4, startX + 4);
      var bottom = Math.max(b.maxy + 4, startY + 4);
      var left = Math.max(1, b.minx - 4);
      await driveUntil(right, b.cy, null, 4000);
      if (!alive()) return early(before);
      await driveUntil(right, bottom, null, 4000);
      if (!alive()) return early(before);
      await driveUntil(left, bottom, null, 6000);
      if (!alive()) return early(before);
      await driveUntil(left, Math.max(1, b.cy - 2), null, 6000);
      if (!alive()) return early(before);
      var closed = await driveUntil(b.cx, b.cy, function () {
        return PZ.game.human.trailCells.size === 0;
      }, 6000);
      var after = PZ.game.grid.percent(1);
      return {
        ok: closed && alive() && after > before + 0.02,
        died: !alive(), before: +before.toFixed(2), after: +after.toFixed(2),
        trail: PZ.game.human.trailCells.size,
        cause: PZ.game.human.deathCause,
        at: [PZ.game.human.cx, PZ.game.human.cy],
        box: b
      };
    }

    async function freshMatch() {
      PZ.startMatch();
      await wait(500);
      return PZ.game;
    }

    /* ------------------------------ меню ------------------------------ */
    check('модули загружены', !!(PZ && PIO && PIO.Game && PIO.Renderer && PIO.UI && PIO.Sound), Object.keys(PIO || {}));
    check('стартовый экран — меню', PZ.screen === 'menu', PZ.screen);
    check('режимов в меню: 4', document.querySelectorAll('.mode').length === 4, document.querySelectorAll('.mode').length);
    check('скинов: 8', document.querySelectorAll('.skin').length === 8, document.querySelectorAll('.skin').length);
    check('демо-матч за меню идёт', !!(PZ.attract && PZ.attract.time > 0), PZ.attract ? +PZ.attract.time.toFixed(2) : null);

    document.querySelector('.mode[data-mode="quick"]').click();
    await wait(40);
    check('выбор режима подсвечивается', document.querySelector('.mode[data-mode="quick"]').classList.contains('is-active'));
    check('настройки свободной игры скрыты', document.getElementById('free-options').classList.contains('is-hidden'));
    document.querySelector('.mode[data-mode="free"]').click();
    await wait(40);
    check('настройки свободной игры показываются', !document.getElementById('free-options').classList.contains('is-hidden'));
    var botsInput = document.getElementById('opt-bots');
    botsInput.value = '0';
    botsInput.dispatchEvent(new Event('input'));
    await wait(60);
    check('ползунок числа ботов применяется', PZ.save.botCount === 0, PZ.save.botCount);

    /* --------------------------- старт матча --------------------------- */
    g = await freshMatch();
    check('матч стартовал', PZ.screen === 'game' && !!g, PZ.screen);
    check('HUD виден', !document.getElementById('hud').classList.contains('is-hidden'));
    check('HUD показывает процент', /^\d+\.\d%$/.test(document.getElementById('hud-percent').textContent),
      document.getElementById('hud-percent').textContent);
    check('свободная игра без ботов', g.players.length === 1 && g.aliveBots().length === 0, g.players.length);
    check('у игрока есть территория', g.grid.ownerCount(1) > 0, g.grid.ownerCount(1));

    var cs = canvasStats();
    check('на канвасе есть отрисовка', cs.colors > 10 && cs.bright > 0.03,
      { colors: cs.colors, bright: +cs.bright.toFixed(2) });
    check('земля игрока видна на канвасе', cs.land > 100, { land: cs.land, samples: cs.samples });

    /* ------------------------ движение и след -------------------------- */
    var x0 = g.human.cx;
    await steerUntil('ArrowRight', function () { return g.human.cx !== x0 || !alive(); }, 1500);
    check('клавиатура двигает игрока', g.human.cx !== x0, { from: x0, to: g.human.cx });
    await steerUntil('ArrowRight', function () { return g.human.trailCells.size > 2 || !alive(); }, 2500);
    check('след формируется вне территории', g.human.trailCells.size > 2, g.human.trailCells.size);

    /* ---------------------------- захват ------------------------------- */
    var cap = await tryCapture();
    if (!cap.ok && cap.died) {
      g = await freshMatch();
      cap = await tryCapture();
      cap.retried = true;
    }
    check('контур замкнулся, площадь выросла', cap.ok, cap);
    check('след очищен после захвата', cap.ok && PZ.game.human.trailCells.size === 0,
      PZ.game.human.trailCells.size);
    check('полоса захвата отрисована', (PZ.renderer.captureCount || 0) > 0, PZ.renderer.captureCount || 0);
    var hudAfter = document.getElementById('hud-percent').textContent;
    check('HUD показывает выросший процент', parseFloat(hudAfter) > cap.before - 0.001, hudAfter);

    /* ----------------------------- пауза ------------------------------- */
    key('Escape');
    await wait(150);
    check('Escape ставит на паузу', PZ.screen === 'pause' &&
      !document.getElementById('screen-pause').classList.contains('is-hidden'), PZ.screen);
    var timeAtPause = PZ.game.time;
    await wait(300);
    check('на паузе время не идёт', Math.abs(PZ.game.time - timeAtPause) < 1e-9,
      [+timeAtPause.toFixed(2), +PZ.game.time.toFixed(2)]);
    check('в паузе показан режим', document.getElementById('pause-info').textContent.indexOf('Свободная') === 0,
      document.getElementById('pause-info').textContent);
    document.getElementById('btn-resume').click();
    await wait(150);
    check('продолжение возвращает в игру', PZ.screen === 'game', PZ.screen);

    /* --------------------------- настройки ----------------------------- */
    if (PZ.screen !== 'game') { g = await freshMatch(); }
    PZ.handleUI('pause');
    await wait(120);
    check('пауза открывается повторно', PZ.screen === 'pause', PZ.screen);
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
    await wait(60);
    document.getElementById('btn-settings-back').click();
    await wait(180);
    check('из настроек возврат в паузу', PZ.screen === 'pause', PZ.screen);
    document.getElementById('btn-resume').click();
    await wait(150);
    check('после настроек матч идёт', PZ.screen === 'game' && PZ.game.state === 'playing', PZ.screen);

    /* ------------------------ результат матча -------------------------- */
    if (!PZ.game || !PZ.game.human.alive || PZ.game.state !== 'playing') { g = await freshMatch(); }
    var matchesBefore = PZ.save.matches;
    PZ.game.kill(PZ.game.human, 'test');
    for (var waitResult = 0; waitResult < 60 && PZ.screen !== 'result'; waitResult++) await wait(50);
    check('смерть игрока открывает результат', PZ.screen === 'result' &&
      !document.getElementById('screen-result').classList.contains('is-hidden'), PZ.debug ? PZ.debug() : PZ.screen);
    check('экран результата заполнен', document.querySelectorAll('#result-grid .stat').length === 6,
      document.querySelectorAll('#result-grid .stat').length);
    var resultCells = Array.prototype.map.call(document.querySelectorAll('#result-grid .stat b'),
      function (n) { return n.textContent; });
    check('значения результата не пустые', resultCells.every(function (v) { return v && v.length; }), resultCells);
    check('результат содержит процент', /^\d+\.\d%$/.test(resultCells[0]), resultCells[0]);
    check('процент в результате совпадает с моделью',
      resultCells[0] === PZ.game.grid.percent(1).toFixed(1) + '%', resultCells[0]);
    check('матч записан в статистику', PZ.save.matches === matchesBefore + 1,
      { before: matchesBefore, after: PZ.save.matches });
    check('сохранение читается обратно', PIO.Storage.load().matches === PZ.save.matches);

    /* ------------------------ повторная игра --------------------------- */
    document.getElementById('btn-again').click();
    await wait(450);
    check('повторная игра запускает новый матч', PZ.screen === 'game' && PZ.game.time < 2.5,
      PZ.game ? +PZ.game.time.toFixed(2) : null);

    /* --------------------------- выход в меню -------------------------- */
    PZ.handleUI('pause');
    await wait(100);
    document.getElementById('btn-menu-pause').click();
    await wait(400);
    check('возврат в меню работает', PZ.screen === 'menu', PZ.screen);
    check('демо-матч перезапущен', !!(PZ.attract && PZ.attract.time > 0),
      PZ.attract ? +PZ.attract.time.toFixed(2) : null);

    /* ------------------ классика: боты и живой матч -------------------- */
    document.querySelector('.mode[data-mode="classic"]').click();
    await wait(60);
    document.getElementById('btn-play').click();
    await wait(1400);
    check('в классике 6 игроков и 5 ботов', PZ.game.players.length === 6 && PZ.game.aliveBots().length === 5,
      { players: PZ.game.players.length, bots: PZ.game.aliveBots().length });
    var botsActive = 0;
    var botList = PZ.game.aliveBots();
    for (var bi = 0; bi < botList.length; bi++) {
      var b = botList[bi];
      if (b.trailCells.size > 0 || b.capturedTotal > 0) botsActive++;
    }
    check('боты двигаются и тянут след', botsActive >= 2, { active: botsActive, bots: botList.length });
    PZ.handleUI('pause');
    await wait(100);
    document.getElementById('btn-menu-pause').click();
    await wait(400);
    check('возврат в меню из классики', PZ.screen === 'menu', PZ.screen);

    /* ----------------------------- рекорды ----------------------------- */
    PZ.handleUI('nav', 'stats');
    await wait(150);
    check('экран рекордов открывается', PZ.screen === 'stats', PZ.screen);
    check('рекорды заполнены', document.querySelectorAll('#stats-grid .stat').length === 8,
      document.querySelectorAll('#stats-grid .stat').length);
    document.querySelector('#screen-stats [data-screen="menu"]').click();
    await wait(180);
    check('возврат из рекордов', PZ.screen === 'menu', PZ.screen);

    /* ----------------------------- вёрстка ----------------------------- */
    var de = document.documentElement;
    check('нет горизонтальной прокрутки', de.scrollWidth <= window.innerWidth + 1,
      { scrollWidth: de.scrollWidth, innerWidth: window.innerWidth });
    var card = document.querySelector('#screen-menu .card');
    var rect = card.getBoundingClientRect();
    check('карточки меню в пределах экрана', rect.left >= -1 && rect.right <= window.innerWidth + 1,
      { left: Math.round(rect.left), right: Math.round(rect.right), w: window.innerWidth });
    var playBtn = document.getElementById('btn-play').getBoundingClientRect();
    check('кнопка «Играть» достаточно крупная', playBtn.height >= 44, Math.round(playBtn.height));
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
    }, 600);
  });
})();
