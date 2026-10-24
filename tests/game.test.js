'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, PHYS, arena, place, driveTo, hashGame } = require('./helpers.js');

test('классический матч стартует с игроком и ботами, у каждого своя земля', () => {
  const game = new Game({ mode: 'classic', mapW: 140, mapH: 140, seed: 42 });
  assert.equal(game.players.length, 6);
  assert.equal(game.players[0].isBot, false);
  assert.equal(game.aliveBots().length, 5);
  const size = game.startSize;
  for (const p of game.players) {
    assert.equal(game.grid.ownerCount(p.id), size * size, `стартовая площадь игрока ${p.id}`);
    assert.equal(p.alive, true);
    assert.ok(typeof p.angle === 'number' && isFinite(p.angle));
  }
  assert.equal(game.state, 'playing');
});

test('боты живут, расширяются и не убиваются о стены', () => {
  const game = new Game({ mode: 'classic', mapW: 140, mapH: 140, seed: 2026, difficulty: 'medium', autopilot: true });
  const start = new Map(game.players.map(p => [p.id, game.grid.ownerCount(p.id)]));
  const causes = {};
  const captures = new Set();
  let steps = 0;
  while (game.time < 45 && game.state === 'playing' && steps < 45 * 60 + 5) {
    game.step(1 / 60);
    steps++;
    for (const ev of game.drainEvents()) {
      if (ev.type === 'death') causes[ev.cause] = (causes[ev.cause] || 0) + 1;
      if (ev.type === 'capture') captures.add(ev.id);
    }
  }
  assert.ok(game.time >= 44, `симуляция дошла только до ${game.time.toFixed(1)} с`);
  assert.equal(game.state, 'playing');
  assert.equal(causes.wall || 0, 0, 'боты не врезаются в границу карты');
  assert.ok((causes.self || 0) <= 3, `самоубийств о свой след: ${causes.self || 0}`);
  const alive = game.players.filter(p => p.alive);
  assert.ok(alive.length >= 2, `живых: ${alive.length}`);
  assert.ok(captures.size >= 2, `захватывали территорию ${captures.size} игроков`);
  const total = alive.reduce((s, p) => s + game.grid.ownerCount(p.id), 0);
  assert.ok(total >= alive.length * 81, `суммарная земля живых: ${total}`);
  assert.ok(start.size === 6, 'шесть игроков на старте');
});

test('на всех уровнях сложности боты играют и расширяются', () => {
  const measure = (difficulty) => {
    const game = new Game({ mode: 'classic', mapW: 130, mapH: 130, seed: 999, difficulty, autopilot: true });
    const start = new Map(game.players.map(p => [p.id, game.grid.ownerCount(p.id)]));
    const causes = {};
    const captures = new Set();
    let steps = 0;
    while (game.time < 30 && game.state === 'playing' && steps < 30 * 60 + 5) {
      game.step(1 / 60);
      steps++;
      for (const ev of game.drainEvents()) {
        if (ev.type === 'death') causes[ev.cause] = (causes[ev.cause] || 0) + 1;
        if (ev.type === 'capture') captures.add(ev.id);
      }
    }
    const alive = game.players.filter(p => p.alive);
    return {
      total: alive.reduce((s, p) => s + game.grid.ownerCount(p.id), 0),
      alive: alive.length,
      captures: captures.size,
      wall: causes.wall || 0,
      self: causes.self || 0
    };
  };
  for (const level of ['easy', 'medium', 'hard']) {
    const r = measure(level);
    assert.equal(r.wall, 0, `${level}: врезались в стену ${r.wall} раз`);
    assert.ok(r.self <= 3, `${level}: самоубийств ${r.self}`);
    assert.ok(r.alive >= 2, `${level}: живых ${r.alive}`);
    assert.ok(r.captures >= 1, `${level}: захватывали ${r.captures}`);
    assert.ok(r.total >= r.alive * 81, `${level}: земля ${r.total} при ${r.alive} живых`);
  }
  const AI = require('../src/ai.js').AI;
  assert.ok(AI.LEVELS.hard.risk > AI.LEVELS.easy.risk);
  assert.ok(AI.LEVELS.hard.aggression > AI.LEVELS.easy.aggression);
  assert.ok(AI.LEVELS.hard.vision > AI.LEVELS.easy.vision);
  assert.ok(AI.LEVELS.hard.interval < AI.LEVELS.easy.interval);
});

test('детерминизм: одинаковый seed даёт одинаковый матч', () => {
  const run = () => {
    const game = new Game({ mode: 'classic', mapW: 120, mapH: 120, seed: 777 });
    for (let i = 0; i < 900; i++) game.step(1 / 60);
    return { hash: hashGame(game), state: game.state };
  };
  const a = run();
  const b = run();
  assert.equal(a.hash, b.hash);
  assert.equal(a.state, b.state);
});

test('смерть игрока завершает матч поражением', () => {
  const { game, p } = arena({ mapW: 80, mapH: 80 });
  place(p, 3, 30, Math.PI);
  p.x = 1.0;
  game.advance(p);
  game.checkEnd();
  assert.equal(game.state, 'over');
  assert.equal(game.result.win, false);
  assert.equal(game.result.reason, 'wall');
  assert.equal(typeof game.result.score, 'number');
});

test('победа по проценту территории в классике', () => {
  const game = new Game({ mode: 'classic', mapW: 100, mapH: 100, seed: 11, goalPercent: 5 });
  game.grid.claimRect(0, 0, 40, 40, 1);
  game.step(1 / 60);
  assert.equal(game.state, 'over');
  assert.equal(game.result.win, true);
  assert.equal(game.result.reason, 'goal');
});

test('быстрый матч: конец по времени и сравнение процентов', () => {
  const game = new Game({ mode: 'quick', mapW: 100, mapH: 100, seed: 3, timeLimit: 4 });
  game.time = 4.01;
  game.checkEnd();
  assert.equal(game.state, 'over');
  assert.equal(game.result.reason, 'time');
  assert.equal(game.result.win, game.result.percent >= game.result.bestBotPercent);
});

test('быстрый матч доигрывается сам до конца', () => {
  const game = new Game({ mode: 'quick', mapW: 100, mapH: 100, seed: 3, timeLimit: 4, autopilot: true });
  let steps = 0;
  while (game.state === 'playing' && steps < 60 * 10) { game.step(1 / 60); steps++; }
  assert.equal(game.state, 'over');
  assert.ok(game.result.time <= 5);
});

test('выживание: соперники прибывают со временем', () => {
  const game = new Game({ mode: 'survival', mapW: 120, mapH: 120, seed: 8 });
  const before = game.players.length;
  game.time = game.nextSpawnAt + 0.01;
  game.updateSurvival();
  assert.ok(game.players.length > before);
  const bot = game.players[game.players.length - 1];
  assert.equal(bot.isBot, true);
  assert.ok(game.grid.ownerCount(bot.id) > 0);
});

test('победа в выживании по времени', () => {
  const game = new Game({ mode: 'survival', mapW: 120, mapH: 120, seed: 8, survivalGoal: 3 });
  game.time = 3.01;
  game.checkEnd();
  assert.equal(game.state, 'over');
  assert.equal(game.result.win, true);
  assert.equal(game.result.reason, 'survived');
});

test('погибшие боты возвращаются на арену', () => {
  const game = new Game({ mode: 'classic', mapW: 110, mapH: 110, seed: 12, autopilot: true });
  const victim = game.aliveBots()[0];
  game.kill(victim, 'test');
  assert.equal(victim.alive, false);
  // прокручиваем время до респавна
  for (let i = 0; i < 60 * 9 && !victim.alive; i++) game.step(1 / 60);
  assert.equal(victim.alive, true, 'бот вернулся через несколько секунд');
  assert.ok(game.grid.ownerCount(victim.id) > 0, 'у него снова есть земля');
  assert.equal(game.state, 'playing', 'матч не заканчивается смертью бота');
});

test('счёт и статистика считаются из реальных данных', () => {
  const game = new Game({ mode: 'classic', mapW: 100, mapH: 100, seed: 13 });
  game.human.kills = 2;
  game.time = 10;
  const st = game.stats();
  assert.equal(st.percent, game.grid.percent(1));
  assert.equal(st.cells, game.grid.ownerCount(1));
  assert.equal(st.kills, 2);
  assert.equal(st.botsAlive, 5);
  assert.equal(st.score, Math.round(st.percent * 100 + 2 * 200 + 10 * 2));
});

test('новый матч после завершения создаётся чистым', () => {
  const first = new Game({ mode: 'classic', mapW: 100, mapH: 100, seed: 21 });
  for (let i = 0; i < 180 && first.state === 'playing'; i++) first.step(1 / 60);
  const second = new Game({ mode: 'classic', mapW: 100, mapH: 100, seed: 21 });
  assert.equal(second.time, 0);
  assert.equal(second.state, 'playing');
  assert.equal(second.events.filter(e => e.type !== 'spawn').length, 0);
  assert.equal(second.players.length, 6);
});

test('захват в реальном матче даёт процент и событие', () => {
  const game = new Game({ mode: 'free', botCount: 0, mapW: 140, mapH: 140, seed: 5 });
  const p = game.human;
  game.grid.releaseTerritory(1);
  game.grid.claimRect(60, 60, 9, 9, 1);
  place(p, 64.5, 64.5, 0);
  const before = game.grid.percent(1);
  const ok = driveTo(game, 1, 64.5, 92, 8) &&
             driveTo(game, 1, 98, 92, 8) &&
             driveTo(game, 1, 98, 44, 10) &&
             driveTo(game, 1, 64.5, 44, 10) &&
             driveTo(game, 1, 64.5, 64.5, 8);
  assert.ok(ok, 'маршрут пройден');
  const events = game.drainEvents().filter(e => e.type === 'capture');
  assert.ok(events.length >= 1, 'событие захвата есть');
  assert.ok(game.grid.percent(1) > before + 1);
  assert.equal(game.human.trail.size, 0);
});
