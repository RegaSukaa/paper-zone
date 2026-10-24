'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, DIRS, arena, walk } = require('./helpers.js');

function place(p, cx, cy) {
  p.cx = cx; p.cy = cy;
  p.x = cx + 0.5; p.y = cy + 0.5;
  p.prevCx = cx; p.prevCy = cy;
}

function addSecond(game, opts) {
  return game.addPlayer(Object.assign({
    id: 2, isBot: false, name: 'Тест', x: 20.5, y: 20.5,
    dir: DIRS[0], skin: 2, startSize: 5
  }, opts));
}

test('свой след: игрок погибает, войдя в свою линию', () => {
  const { game, p } = arena({ mapW: 30, mapH: 30 });
  place(p, 5, 5);
  game.grid.addTrailAt(6, 5, 1);
  const ok = game.enterCell(p, 6, 5);
  assert.equal(ok, false);
  assert.equal(p.alive, false);
  assert.equal(p.deathCause, 'self');
  assert.equal(game.grid.trailLength(1), 0);
});

test('чужой след: пересечение убивает владельца, а не того, кто пересёк', () => {
  const { game, p } = arena({ mapW: 30, mapH: 30 });
  const q = addSecond(game);
  place(p, 5, 5);
  place(q, 12, 12);
  game.grid.addTrailAt(6, 5, 2);
  const ok = game.enterCell(p, 6, 5);
  assert.equal(ok, true);
  assert.equal(p.alive, true);
  assert.equal(q.alive, false);
  assert.equal(q.deathCause, 'cut');
  assert.equal(p.kills, 1);
  assert.equal(game.grid.trailLength(2), 0, 'след убитого очищен');
});

test('двойное столкновение: каждый пересёк след другого — гибнут оба', () => {
  const { game, p } = arena({ mapW: 30, mapH: 30 });
  const q = addSecond(game);
  place(p, 5, 5);
  place(q, 6, 5);
  game.grid.addTrailAt(6, 5, 1); // мой след впереди
  game.grid.addTrailAt(6, 5, 2); // и его след в той же клетке
  game.enterCell(p, 6, 5);
  assert.equal(p.alive, false);
  assert.equal(q.alive, false);
  assert.equal(q.deathCause, 'cut', 'чужой след пересёк — он погиб');
  assert.equal(p.deathCause, 'self', 'и в свой след тоже попал');
});

test('граница карты убивает', () => {
  const { game, p } = arena({ mapW: 30, mapH: 30 });
  place(p, 0, 5);
  assert.equal(game.enterCell(p, -1, 5), false);
  assert.equal(p.deathCause, 'wall');
  const a = arena({ mapW: 30, mapH: 30 });
  place(a.p, 29, 5);
  assert.equal(a.game.enterCell(a.p, 30, 5), false);
  assert.equal(a.p.deathCause, 'wall');
});

test('стены карты убивают и не участвуют в площади', () => {
  const { game, p } = arena({ mapW: 30, mapH: 30 });
  game.grid.setWall(6, 5, true);
  place(p, 5, 5);
  assert.equal(game.enterCell(p, 6, 5), false);
  assert.equal(p.deathCause, 'wall');
  assert.equal(game.grid.freeCells(), 900 - 1);
});

test('лобовое столкновение в одной клетке убивает обоих', () => {
  const { game, p } = arena({ mapW: 30, mapH: 30 });
  const q = addSecond(game);
  place(p, 6, 5);
  place(q, 6, 5);
  game.resolveHeadCollisions();
  assert.equal(p.alive, false);
  assert.equal(q.alive, false);
  assert.equal(p.deathCause, 'head');
  assert.equal(q.deathCause, 'head');
});

test('обмен клетками за шаг тоже считается столкновением', () => {
  const { game, p } = arena({ mapW: 30, mapH: 30 });
  const q = addSecond(game);
  place(p, 6, 5); p.prevCx = 5; p.prevCy = 5;
  place(q, 5, 5); q.prevCx = 6; q.prevCy = 5;
  p.cx = 6; p.cy = 5; q.cx = 5; q.cy = 5;
  game.resolveHeadCollisions();
  assert.equal(p.alive, false);
  assert.equal(q.alive, false);
  assert.equal(p.deathCause, 'swap');
});

test('смерть бота освобождает его территорию, территория игрока сохраняется', () => {
  const { game, p } = arena({ mapW: 30, mapH: 30 });
  game.grid.claimRect(3, 3, 5, 5, 1);
  const q = addSecond(game);
  assert.ok(game.grid.ownerCount(2) > 0);
  game.kill(q, 'test');
  assert.equal(game.grid.ownerCount(2), 0, 'земля бота ушла в нейтраль');
  const before = game.grid.ownerCount(1);
  assert.ok(before > 0);
  game.kill(p, 'test');
  assert.equal(game.grid.ownerCount(1), before, 'земля игрока остаётся для экрана результатов');
});

test('разворот на 180° запрещён, пока тянется след', () => {
  const { game, p } = arena({ mapW: 40, mapH: 40 });
  game.grid.claimRect(2, 18, 8, 8, 1);
  place(p, 5, 21);
  p.dir = DIRS[0]; p.nextDir = DIRS[0];

  walk(game, 1, DIRS[0], 5); // выходим за свою землю
  assert.equal(p.trailing, true);
  assert.ok(p.trailCells.size > 0);

  game.setDirection(1, DIRS[2]); // назад
  for (let i = 0; i < 12; i++) game.step(1 / 60);
  assert.equal(p.alive, true);
  assert.equal(p.dir.x, 1, 'направление не развернулось');

  game.setDirection(1, DIRS[1]); // перпендикуляр разрешён
  for (let i = 0; i < 12; i++) game.step(1 / 60);
  assert.equal(p.dir.y, 1);
  assert.equal(p.alive, true);
});

test('возврат на свою территорию замыкает след и захватывает площадь', () => {
  const { game, p } = arena({ mapW: 40, mapH: 40 });
  game.grid.releaseTerritory(1);
  game.grid.claimRect(2, 10, 6, 6, 1);
  place(p, 7, 12);
  p.dir = DIRS[0]; p.nextDir = DIRS[0];
  const startCount = game.grid.ownerCount(1);
  assert.equal(startCount, 36);

  walk(game, 1, DIRS[0], 4);  // вправо до x=11
  walk(game, 1, DIRS[1], 3);  // вниз до y=15
  walk(game, 1, DIRS[2], 4);  // влево, возвращаемся на свою землю в (7,15)

  assert.equal(p.alive, true);
  assert.equal(p.trailing, false);
  assert.equal(game.grid.trailLength(1), 0);
  assert.equal(game.grid.ownerAt(9, 13), 1, 'внутренняя клетка захвачена');
  assert.equal(game.grid.ownerAt(11, 13), 1, 'след стал землёй');
  assert.equal(game.grid.ownerAt(12, 13), 0, 'снаружи не залито');
  assert.equal(game.grid.ownerCount(1), 36 + 10 + 6, 'территория, след и внутренность');
  assert.ok(Math.abs(game.grid.percent(1) - (52 / 1600) * 100) < 1e-9);
});
