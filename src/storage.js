/* ============================================================================
 * storage.js — сохранение прогресса и настроек в localStorage.
 * Работает и без хранилища (приватный режим, отключённые данные): тогда
 * используется память на время сессии, игра не падает.
 * ==========================================================================*/
(function (root) {
  'use strict';

  var KEY = 'paperzone.save.v1';
  var MODES = ['classic', 'survival', 'quick', 'free'];
  var LEVELS = ['easy', 'medium', 'hard'];

  var memory = null;

  function defaults() {
    return {
      version: 1,
      matches: 0,
      wins: 0,
      losses: 0,
      kills: 0,
      bestScore: 0,
      bestPercent: 0,
      bestSurvival: 0,
      skin: 0,
      lastMode: 'classic',
      lastDifficulty: 'medium',
      botCount: 5,
      mapSize: 'medium',
      speed: 11,
      settings: { sound: true, volume: 0.6, minimap: true, shake: true }
    };
  }

  function num(v, def, min, max) {
    v = Number(v);
    if (!isFinite(v)) return def;
    return Math.min(max, Math.max(min, v));
  }
  function bool(v, def) { return typeof v === 'boolean' ? v : def; }
  function pick(v, list, def) { return list.indexOf(v) === -1 ? def : v; }

  function sanitize(raw) {
    var d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    d.matches = Math.floor(num(raw.matches, 0, 0, 1e9));
    d.wins = Math.floor(num(raw.wins, 0, 0, 1e9));
    d.losses = Math.floor(num(raw.losses, 0, 0, 1e9));
    d.kills = Math.floor(num(raw.kills, 0, 0, 1e9));
    d.bestScore = Math.floor(num(raw.bestScore, 0, 0, 1e12));
    d.bestPercent = num(raw.bestPercent, 0, 0, 100);
    d.bestSurvival = num(raw.bestSurvival, 0, 0, 1e6);
    d.skin = Math.floor(num(raw.skin, 0, 0, 7));
    d.lastMode = pick(raw.lastMode, MODES, 'classic');
    d.lastDifficulty = pick(raw.lastDifficulty, LEVELS, 'medium');
    d.botCount = Math.floor(num(raw.botCount, 5, 0, 7));
    d.speed = Math.floor(num(raw.speed, 11, 7, 16));
    if (raw.mapSize === 'small' || raw.mapSize === 'large') d.mapSize = raw.mapSize;
    var s = raw.settings || {};
    d.settings = {
      sound: bool(s.sound, true),
      volume: num(s.volume, 0.6, 0, 1),
      minimap: bool(s.minimap, true),
      shake: bool(s.shake, true)
    };
    return d;
  }

  function store() {
    try {
      var ls = window.localStorage;
      var probe = '__pz_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    } catch (e) {
      return null;
    }
  }

  function load() {
    var ls = store();
    if (!ls) return memory || (memory = defaults());
    try {
      var raw = ls.getItem(KEY);
      if (!raw) return defaults();
      return sanitize(JSON.parse(raw));
    } catch (e) {
      return defaults();
    }
  }

  function save(state) {
    state = sanitize(state);
    var ls = store();
    if (!ls) { memory = state; return false; }
    try {
      ls.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      memory = state;
      return false;
    }
  }

  function reset() {
    var d = defaults();
    var ls = store();
    if (ls) { try { ls.removeItem(KEY); } catch (e) {} }
    return d;
  }

  /* Записать итог матча. Возвращает отметки о новых рекордах. */
  function recordMatch(state, result) {
    var rec = { bestScore: false, bestPercent: false, bestSurvival: false };
    state.matches += 1;
    if (result.win) state.wins += 1; else state.losses += 1;
    state.kills += result.kills || 0;
    if (result.score > state.bestScore) { state.bestScore = result.score; rec.bestScore = true; }
    if (result.percent > state.bestPercent) { state.bestPercent = result.percent; rec.bestPercent = true; }
    if (result.mode === 'survival' && result.time > state.bestSurvival) {
      state.bestSurvival = result.time;
      rec.bestSurvival = true;
    }
    save(state);
    return rec;
  }

  root.PIO = root.PIO || {};
  root.PIO.Storage = {
    KEY: KEY,
    defaults: defaults,
    sanitize: sanitize,
    load: load,
    save: save,
    reset: reset,
    recordMatch: recordMatch
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
