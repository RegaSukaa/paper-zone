/* ============================================================================
 * main.js — сборка приложения: цикл, экраны, события, звук, сохранения.
 * ==========================================================================*/
(function () {
  'use strict';

  var PIO = window.PIO;
  var $ = function (id) { return document.getElementById(id); };
  var STEP = PIO.FIXED_STEP;
  var SIZE_MAP = { small: 120, medium: 160, large: 220 };

  var canvas = $('field');
  var renderer = new PIO.Renderer(canvas);
  var save = PIO.Storage.load();
  var settings = save.settings;

  var config = {
    mode: save.lastMode || 'classic',
    difficulty: save.lastDifficulty || 'medium',
    skinId: save.skinId || 'mint',
    botCount: save.botCount,
    mapSize: save.mapSize || 'medium',
    speed: save.speed || 13.5
  };

  var screen = 'menu';
  var game = null;
  var attract = null;
  var attractAcc = 0;
  var acc = 0;
  var last = performance.now();
  var lastFrame = last;
  var hudAcc = 0;
  var settingsReturn = 'menu';
  var resetArmed = 0;
  var input = null;
  var uiLog = [];

  /* ------------------------------ настройки ----------------------------- */

  function applySettings() {
    PIO.Sound.setEnabled(settings.sound);
    PIO.Sound.setVolume(settings.volume);
    renderer.minimapOn = settings.minimap;
    renderer.opts.shakeEnabled = settings.shake;
  }

  function persist() { PIO.Storage.save(save); }

  /* -------------------------------- матч -------------------------------- */

  function startMatch() {
    var mapSize = config.mode === 'free'
      ? (SIZE_MAP[config.mapSize] || 160)
      : (config.mode === 'quick' ? 150 : 160);
    var speed = config.mode === 'free' ? config.speed : 13.5;
    var seed = (Date.now() ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0;

    game = new PIO.Game({
      mode: config.mode,
      difficulty: config.difficulty,
      mapW: mapSize,
      mapH: mapSize,
      botCount: config.botCount,
      speed: speed,
      goalPercent: 30,
      seed: seed,
      playerSkin: config.skinId
    });
    if (game.human) game.human.speed = speed; // сложность ускоряет только ботов

    renderer.setGame(game);
    renderer.opts.shakeEnabled = settings.shake;
    renderer.minimapOn = settings.minimap;
    attract = null;
    screen = 'game';
    acc = 0;
    hudAcc = 0;
    last = performance.now();
    game.drainEvents();
    PIO.UI.show('game');
    PIO.UI.updateHUD(game);
    PIO.Sound.play('start');
  }

  function finishMatch() {
    if (!game || !game.result) return;
    var result = game.result;
    screen = 'result';
    var rec = PIO.Storage.recordMatch(save, result);
    PIO.UI.showResult(result, rec, save.bestScore);
    PIO.Sound.play(result.win ? 'win' : 'lose');
  }

  function togglePause() {
    if (screen === 'game' && game) {
      screen = 'pause';
      PIO.UI.setPauseInfo(game);
      PIO.UI.show('pause');
      return;
    }
    if (screen === 'pause' && game) {
      screen = 'game';
      acc = 0;
      last = performance.now();
      PIO.UI.show('game');
      PIO.UI.updateHUD(game);
    }
  }

  function toMenu() {
    screen = 'menu';
    game = null;
    PIO.UI.syncMenu(config);
    PIO.UI.renderStats(save);
    PIO.UI.show('menu');
    startAttract();
  }

  function startAttract() {
    attractAcc = 0;
    attract = new PIO.Game({
      mode: 'classic',
      difficulty: 'medium',
      mapW: 150,
      mapH: 150,
      botCount: 5,
      speed: 13.5,
      seed: (Math.random() * 0xffffffff) >>> 0,
      autopilot: true,
      playerSkin: config.skinId
    });
    renderer.setGame(attract);
    renderer.minimapOn = settings.minimap;
  }

  function goto(name) {
    if (name === 'menu') { toMenu(); return; }
    if (name === 'settings') {
      settingsReturn = (screen === 'pause') ? 'pause' : 'menu';
      PIO.UI.syncSettings(settings);
      screen = 'settings';
      PIO.UI.show('settings');
      return;
    }
    if (name === 'stats') {
      PIO.UI.renderStats(save);
      screen = 'stats';
      PIO.UI.show('stats');
      return;
    }
    if (name === 'help') {
      screen = 'help';
      PIO.UI.show('help');
    }
  }

  function settingsBack() {
    if (settingsReturn === 'pause' && game) {
      screen = 'pause';
      PIO.UI.setPauseInfo(game);
      PIO.UI.show('pause');
    } else {
      toMenu();
    }
  }

  function handleReset() {
    var now = Date.now();
    if (now - resetArmed < 4000) {
      resetArmed = 0;
      save = PIO.Storage.reset();
      settings = save.settings;
      applySettings();
      PIO.UI.syncSettings(settings);
      PIO.UI.renderStats(save);
      PIO.UI.syncMenu(config);
      PIO.UI.toast('Прогресс сброшен');
    } else {
      resetArmed = now;
      PIO.UI.toast('Нажми ещё раз в течение 4 секунд');
    }
  }

  /* ------------------------------- UI-события --------------------------- */

  function handleUI(type, payload) {
    if (uiLog.length > 80) uiLog.shift();
    uiLog.push(type + (typeof payload === 'string' ? ':' + payload : ''));
    switch (type) {
      case 'click':
        PIO.Sound.init();
        PIO.Sound.play('click');
        break;
      case 'play': startMatch(); break;
      case 'mode':
        config.mode = payload; save.lastMode = payload; persist(); PIO.UI.syncMenu(config);
        break;
      case 'difficulty':
        config.difficulty = payload; save.lastDifficulty = payload; persist(); PIO.UI.syncMenu(config);
        break;
      case 'skin':
        config.skinId = payload; save.skinId = payload; persist();
        PIO.UI.setSkin(payload);
        if (attract) attract.cfg.playerSkin = payload;
        break;
      case 'free':
        config.botCount = payload.botCount;
        config.mapSize = payload.mapSize;
        config.speed = payload.speed;
        save.botCount = payload.botCount;
        save.mapSize = payload.mapSize;
        save.speed = payload.speed;
        persist();
        break;
      case 'settings':
        settings.sound = payload.sound;
        settings.volume = payload.volume;
        settings.minimap = payload.minimap;
        settings.shake = payload.shake;
        save.settings = settings;
        applySettings();
        persist();
        break;
      case 'settingsOpen': goto('settings'); break;
      case 'settingsBack': settingsBack(); break;
      case 'nav': goto(payload); break;
      case 'reset': handleReset(); break;
      case 'pause': if (screen === 'game' || screen === 'pause') togglePause(); break;
      case 'resume': if (screen === 'pause') togglePause(); break;
      case 'restart': startMatch(); break;
      case 'menu': toMenu(); break;
      case 'again': startMatch(); break;
      default: break;
    }
  }

  /* -------------------------------- события ----------------------------- */

  function findPlayer(g, id) {
    for (var i = 0; i < g.players.length; i++) if (g.players[i].id === id) return g.players[i];
    return null;
  }

  function handleGameEvents(g, silent) {
    var events = g.drainEvents();
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.type === 'capture') {
        renderer.addCaptureEffect(ev);
        if (!silent && ev.id === 1) {
          PIO.Sound.play(ev.count > 500 ? 'bigCapture' : 'capture');
        }
      } else if (ev.type === 'death') {
        var dead = findPlayer(g, ev.id);
        var color = dead ? dead.palette.head : '#ffffff';
        renderer.addDeathEffect(ev.x, ev.y, color);
        if (!silent) {
          if (ev.id === 1) PIO.Sound.play('death');
          else if (ev.killer === 1) PIO.Sound.play('kill');
        }
      } else if (ev.type === 'spawn') {
        if (ev.respawn) renderer.registerPlayer(findPlayer(g, ev.id));
        if (!silent && ev.isBot && ev.respawn) PIO.Sound.play('spawn');
      }
    }
  }

  /* --------------------------------- цикл ------------------------------- */

  function loop(now) {
    var dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.25) dt = 0.25;
    lastFrame = now;

    if (screen === 'game' && game) {
      acc += dt;
      var steps = 0;
      while (acc >= STEP && steps < 8) {
        game.step(STEP);
        acc -= STEP;
        steps++;
      }
      if (steps >= 8) acc = 0;
      handleGameEvents(game, false);
      if (game.state === 'over') finishMatch();
      hudAcc -= dt;
      if (hudAcc <= 0 && screen === 'game') {
        hudAcc = 0.1;
        PIO.UI.updateHUD(game);
      }
    } else if (screen === 'menu' && attract) {
      attractAcc += dt;
      var at = 0;
      while (attractAcc >= STEP && at < 4) {
        attract.step(STEP);
        attractAcc -= STEP;
        at++;
      }
      handleGameEvents(attract, true);
      if (attract.state === 'over' || attract.time > 70) startAttract();
    }

    renderer.update(dt);
    renderer.draw(dt);
    PIO.UI.animate(now);
  }

  function rafLoop(now) {
    loop(now);
    requestAnimationFrame(rafLoop);
  }

  /* Страховка от замороженного requestAnimationFrame (фоновая вкладка,
   * headless-браузер, троттлинг): если кадров нет дольше 220 мс, шагаем сами. */
  setInterval(function () {
    var now = performance.now();
    if (now - lastFrame > 220) loop(now);
  }, 120);

  /* ------------------------------- ввод --------------------------------- */

  input = PIO.Input.attach(canvas, {
    knob: document.querySelector('#drag-ring .drag__knob'),
    onAngle: function (angle) {
      if (screen === 'game' && game) game.steer(angle);
    },
    onPause: function () {
      if (screen === 'game' || screen === 'pause') togglePause();
    },
    getHeadScreen: function () {
      if (!game || !game.human || !game.human.alive) return null;
      return renderer.worldToScreen(game.human.x, game.human.y);
    }
  });

  window.addEventListener('resize', function () { renderer.resize(); });
  window.addEventListener('orientationchange', function () {
    setTimeout(function () { renderer.resize(); }, 180);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && screen === 'game') togglePause();
  });

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey) return;
    if (e.code === 'KeyR' && screen === 'result') startMatch();
  });

  window.addEventListener('pointerdown', function () { PIO.Sound.init(); }, { once: true });
  window.addEventListener('keydown', function () { PIO.Sound.init(); }, { once: true });

  /* --------------------------------- старт ------------------------------- */

  applySettings();
  PIO.UI.init({ on: handleUI });
  PIO.UI.syncMenu(config);
  PIO.UI.syncSettings(settings);
  PIO.UI.renderStats(save);
  PIO.UI.show('menu');
  startAttract();
  requestAnimationFrame(rafLoop);

  /* отладочные хуки для браузерных проверок */
  window.__PZ = {
    get game() { return game; },
    get attract() { return attract; },
    get screen() { return screen; },
    get renderer() { return renderer; },
    get save() { return save; },
    debug: function () {
      return {
        screen: screen, settingsReturn: settingsReturn, hasGame: !!game,
        gameState: game ? game.state : null, log: uiLog.slice(-12)
      };
    },
    startMatch: startMatch,
    toMenu: toMenu,
    handleUI: handleUI,
    startAttract: startAttract
  };
})();
