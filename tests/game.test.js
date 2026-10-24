'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, DIRS, walk, arena } = require('./helpers.js');

function hashGame(game) {
  let h = 2166136261 >>> 0;
  const owner = game.grid.owner;
  for (let i = 0; i < owner.length; i++) {
    h ^= owner[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  for (const p of game.players) {
    h ^= (p.cx * 31 + p.cy) | 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

test('классический матч стартует с игроком и ботами, у каждого своя земля', () => {
  const game = new Game({ mode: 'classic', mapW: 120, mapH: 120, seed: 42 });
  assert.equal(game.players.length, 6);
  assert.equal(game.players[0].isBot, false);
  assert.equal(game.aliveBots().length, 5);
  const size = game.startSize;
  for (const p of game.players) {
    assert.equal(game.grid.ownerCount(p.id), size * size, `стартовая площадь игрока ${p.id}`);
    assert.equal(p.alive, true);
  }
  assert.ok(game.grid.percent(1) > 0);
  assert.equal(game.state, 'playing');
});

test('выход за свою территорию начинает след вне земли', () => {
  const game = new Game({ mode: 'classic', mapW: 120, mapH: 120, seed: 42 });
  const p = game.human;
  walk(game, 1, DIRS[0], 1);
  assert.equal(p.alive, true);
  assert.equal(p.trailCells.size, 0, 'внутри земли следа нет');
  walk(game, 1, DIRS[0], 6);
  assert.equal(p.trailing, true);
  assert.ok(p.trailCells.size > 0);
  assert.ok(p.trailPath.length > 0);
});

test('свободная игра без ботов: полный цикл захвата через движение', () => {
  const game = new Game({ mode: 'free', botCount: 0, mapW: 40, mapH: 40, seed: 5 });
  const p = game.human;
  game.grid.releaseTerritory(1);
  game.grid.claimRect(2, 10, 6, 6, 1);
  p.cx = 7; p.cy = 12; p.x = 7.5; p.y = 12.5;
  p.dir = DIRS[0]; p.nextDir = DIRS[0];

  walk(game, 1, DIRS[0], 4);
  walk(game, 1, DIRS[1], 3);
  walk(game, 1, DIRS[2], 4);

  assert.equal(p.alive, true);
  assert.equal(game.grid.ownerCount(1), 36 + 16);
  assert.equal(game.players.length, 1);
});

test('боты живут, расширяются и не убиваются о стены', () => {
  const game = new Game({ mode: 'classic', mapW: 120, mapH: 120, seed: 2026, difficulty: 'medium', autopilot: true });
  const startCounts = new Map();
  for (const p of game.players) startCounts.set(p.id, game.grid.ownerCount(p.id));
  const causes = {};
  let steps = 0;
  while (game.time < 45 && game.state === 'playing' && steps < 45 * 60 + 5) {
    game.step(1 / 60);
    steps++;
    for (const ev of game.drainEvents()) {
      if (ev.type === 'death') causes[ev.cause] = (causes[ev.cause] || 0) + 1;
    }
  }
  assert.ok(game.time >= 44, `симуляция дошла только до ${game.time.toFixed(1)} c`);
  assert.equal(game.state, 'playing', 'матч не должен закончиться сам за 45 секунд');
  assert.equal(causes.wall || 0, 0, 'боты не врезаются в границу карты');
  assert.ok((causes.self || 0) <= 2, `самоубийств о свой след слишком много: ${causes.self || 0}`);
  const alive = game.players.filter(p => p.alive);
  assert.ok(alive.length >= 3, `осталось игроков: ${alive.length}`);
  let grown = 0;
  for (const b of alive) {
    if (game.grid.ownerCount(b.id) > startCounts.get(b.id)) grown++;
  }
  assert.ok(grown >= Math.max(2, alive.length - 1), `расширились ${grown} из ${alive.length}`);
  const totalBot = alive.reduce((s, b) => s + game.grid.ownerCount(b.id), 0);
  assert.ok(totalBot > 6 * 36 * 1.2, `суммарная земля живых ${totalBot}`);
});

test('на всех уровнях сложности боты играют и расширяются', () => {
  const measure = (difficulty) => {
    const game = new Game({ mode: 'classic', mapW: 110, mapH: 110, seed: 999, difficulty, autopilot: true });
    const start = new Map(game.players.map(p => [p.id, game.grid.ownerCount(p.id)]));
    const causes = {};
    let steps = 0;
    while (game.time < 30 && game.state === 'playing' && steps < 30 * 60 + 5) {
      game.step(1 / 60);
      steps++;
      for (const ev of game.drainEvents()) {
        if (ev.type === 'death') causes[ev.cause] = (causes[ev.cause] || 0) + 1;
      }
    }
    const alive = game.players.filter(p => p.alive);
    const total = alive.reduce((s, p) => s + game.grid.ownerCount(p.id), 0);
    const grown = alive.filter(p => game.grid.ownerCount(p.id) > start.get(p.id)).length;
    return { game, total, alive: alive.length, grown, wall: causes.wall || 0, self: causes.self || 0 };
  };
  const levels = ['easy', 'medium', 'hard'];
  const results = {};
  for (const level of levels) {
    const r = measure(level);
    results[level] = r;
    assert.equal(r.wall, 0, `${level}: врезались в стену ${r.wall} раз`);
    assert.ok(r.self <= 2, `${level}: самоубийств ${r.self}`);
    assert.ok(r.alive >= 3, `${level}: живых ${r.alive}`);
    assert.ok(r.grown >= r.alive - 1, `${level}: расширились ${r.grown} из ${r.alive}`);
    assert.ok(r.total > 216 * 1.15, `${level}: суммарная земля ${r.total}`);
  }
  // сложность меняет параметры, а не только скорость
  const AI = require('../src/ai.js').AI;
  assert.ok(AI.LEVELS.hard.risk > AI.LEVELS.easy.risk);
  assert.ok(AI.LEVELS.hard.aggression > AI.LEVELS.easy.aggression);
  assert.ok(AI.LEVELS.hard.vision > AI.LEVELS.easy.vision);
  assert.ok(AI.LEVELS.hard.interval < AI.LEVELS.easy.interval);
});

test('детерминизм: одинаковый seed даёт одинаковый матч', () => {
  const run = () => {
    const game = new Game({ mode: 'classic', mapW: 100, mapH: 100, seed: 777 });
    for (let i = 0; i < 900; i++) game.step(1 / 60);
    return { hash: hashGame(game), time: game.time, state: game.state };
  };
  const a = run();
  const b = run();
  assert.equal(a.hash, b.hash);
  assert.equal(a.state, b.state);
});

test('смерть игрока завершает матч поражением', () => {
  const { game, p } = arena({ mapW: 30, mapH: 30 });
  p.cx = 0; p.cy = 5; p.x = 0.5; p.y = 5.5;
  game.enterCell(p, -1, 5);
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
  assert.ok(game.result.percent >= 5);
});

test('быстрый матч заканчивается по времени и сравнивает проценты', () => {
  const game = new Game({ mode: 'quick', mapW: 100, mapH: 100, seed: 3, timeLimit: 4 });
  game.time = 4.01;
  game.checkEnd();
  assert.equal(game.state, 'over');
  assert.equal(game.result.reason, 'time');
  assert.equal(game.result.win, game.result.percent >= game.result.bestBotPercent);
});

test('быстрый матч доигрывается до конца без внешнего таймера', () => {
  const game = new Game({ mode: 'quick', mapW: 100, mapH: 100, seed: 3, timeLimit: 4, autopilot: true });
  let steps = 0;
  while (game.state === 'playing' && steps < 60 * 10) { game.step(1 / 60); steps++; }
  assert.equal(game.state, 'over');
  assert.ok(game.result.time <= 5, 'матч не длится дольше лимита');
});

test('выживание: соперники прибывают со временем', () => {
  const game = new Game({ mode: 'survival', mapW: 100, mapH: 100, seed: 8 });
  const before = game.players.length;
  game.time = game.nextSpawnAt + 0.01;
  game.updateSurvival();
  assert.ok(game.players.length > before, 'новый бот добавлен');
  const bot = game.players[game.players.length - 1];
  assert.equal(bot.isBot, true);
  assert.ok(game.grid.ownerCount(bot.id) > 0);
});

test('победа в выживании по времени', () => {
  const game = new Game({ mode: 'survival', mapW: 100, mapH: 100, seed: 8, survivalGoal: 3 });
  game.time = 3.01;
  game.checkEnd();
  assert.equal(game.state, 'over');
  assert.equal(game.result.win, true);
  assert.equal(game.result.reason, 'survived');
});

test('победа уничтожением всех соперников', () => {
  const game = new Game({ mode: 'classic', mapW: 100, mapH: 100, seed: 12 });
  for (const b of game.aliveBots()) game.kill(b, 'test');
  game.checkEnd();
  assert.equal(game.state, 'over');
  assert.equal(game.result.win, true);
  assert.equal(game.result.reason, 'lastman');
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
