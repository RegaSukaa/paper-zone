'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, PHYS, angNorm, arena, place, driveTo, driveAngle, trailCells, isConnected } = require('./helpers.js');

const DT = 1 / 60;

test('курс задаётся произвольным углом, а не четырьмя направлениями', () => {
  const { game, p } = arena();
  place(p, 50, 50, 0);
  const angles = [0, Math.PI / 6, Math.PI / 4, 2.2, Math.PI, -2.5];
  for (const a of angles) {
    place(p, 50, 50, a);
    driveAngle(game, 1, a, 0.12);
    assert.ok(Math.abs(angNorm(p.angle - a)) < 0.02, `угол ${a.toFixed(2)} отработан, получили ${p.angle.toFixed(2)}`);
  }
});

test('диагональ не быстрее прямой: скорость постоянна', () => {
  const measure = (angle) => {
    const { game, p } = arena({ mapW: 200, mapH: 200 });
    place(p, 100, 100, angle);
    const x0 = p.x, y0 = p.y;
    driveAngle(game, 1, angle, 0.5);
    return Math.hypot(p.x - x0, p.y - y0);
  };
  const straight = measure(0);
  const diagonal = measure(Math.PI / 4);
  const odd = measure(1.1);
  assert.ok(Math.abs(straight - diagonal) < 0.05, `прямо ${straight.toFixed(3)} против диагонали ${diagonal.toFixed(3)}`);
  assert.ok(Math.abs(straight - odd) < 0.05);
  assert.ok(straight > PHYS.speed * 0.45 && straight < PHYS.speed * 0.55, 'за 0.5 с пройдено около половины скорости');
});

test('поворот плавный: угловая скорость ограничена', () => {
  const { game, p } = arena();
  place(p, 50, 50, 0);
  game.setTargetAngle(1, Math.PI);
  game.step(DT);
  assert.ok(p.angle > 0 && p.angle <= PHYS.turnRate * DT + 1e-6, `за шаг повернулись на ${p.angle.toFixed(4)}`);
  driveAngle(game, 1, Math.PI, 1);
  assert.ok(Math.abs(angNorm(p.angle - Math.PI)) < 1e-6, 'за секунду курс дошёл до цели');
});

test('след непрерывен при движении под 45°', () => {
  const { game, p } = arena({ mapW: 160, mapH: 160 });
  place(p, 40, 40, Math.PI / 4);
  driveAngle(game, 1, Math.PI / 4, 1.2);
  const cells = trailCells(game, 1);
  assert.ok(cells.length > 8, `клеток следа: ${cells.length}`);
  assert.ok(isConnected(game, cells), 'все клетки следа 4-связны — разрывов нет');
});

test('нет пропусков следа при крупном шаге симуляции (низкий FPS)', () => {
  const { game, p } = arena({ mapW: 160, mapH: 160 });
  place(p, 40, 40, 1.0);
  game.setTargetAngle(1, 1.0);
  for (let i = 0; i < 12; i++) game.step(0.1); // 100 мс на кадр
  const cells = trailCells(game, 1);
  assert.ok(cells.length > 8, `клеток: ${cells.length}`);
  assert.ok(isConnected(game, cells), 'подшаги не дают разрывов даже при 10 FPS');
});

test('прямой ход не убивает о собственный след', () => {
  const { game, p } = arena({ mapW: 200, mapH: 200 });
  place(p, 60, 60, Math.PI / 3);
  driveAngle(game, 1, Math.PI / 3, 2.5);
  assert.equal(p.alive, true);
  assert.ok(p.trail.size > 40, 'след растёт');
});

test('плавная петля замыкается и захватывает площадь', () => {
  const { game, p } = arena({ mapW: 140, mapH: 140 });
  game.grid.claimRect(60, 60, 9, 9, 1);
  place(p, 64.5, 64.5, 0);
  const before = game.grid.percent(1);
  const ok = driveTo(game, 1, 64.5, 92, 8) &&
             driveTo(game, 1, 98, 92, 8) &&
             driveTo(game, 1, 98, 44, 10) &&
             driveTo(game, 1, 64.5, 44, 10);
  assert.ok(ok, 'все точки маршрута достигнуты');
  driveTo(game, 1, 64.5, 64.5, 8);
  const after = game.grid.percent(1);
  assert.equal(p.alive, true, 'петля не должна убивать');
  assert.ok(after > before + 1, `площадь выросла: ${before.toFixed(2)}% → ${after.toFixed(2)}%`);
  assert.equal(p.trail.size, 0, 'след превратился в территорию');
  assert.equal(game.grid.trailLength(1), 0);
});

test('свой след впереди — смерть', () => {
  const { game, p } = arena();
  place(p, 51.5, 50.5, 0);          // голова в клетке (51,50)
  game.grid.addTrailAt(51, 50, 1);   // и там же свой след
  p.recent.clear();
  game.advance(p);
  assert.equal(p.alive, false);
  assert.equal(p.deathCause, 'self');
});

test('чужой след под головой убивает его владельца', () => {
  const { game, p } = arena();
  const q = game.addPlayer({ id: 2, isBot: false, name: 'Тест', x: 80.5, y: 80.5, angle: 0, skinId: 'robot', startSize: 7 });
  game.grid.addTrailAt(51, 50, 2);
  place(p, 51.5, 50.5, 0);
  game.advance(p);
  assert.equal(p.alive, true);
  assert.equal(q.alive, false);
  assert.equal(q.deathCause, 'cut');
  assert.equal(p.kills, 1);
});

test('граница круга не убивает: персонаж скользит по кромке', () => {
  const { game, p } = arena({ mapW: 60, mapH: 60 });
  const c = game.grid.circle;
  assert.ok(c, 'у арены есть круг');
  // ставим близко к кромке и гоним наружу
  const angOut = 0;
  place(p, c.cx + c.r - 3, c.cy, angOut);
  driveAngle(game, 2.5, angOut, 3);
  assert.equal(p.alive, true, 'о край больше не умирают');
  const d = Math.hypot(p.x - c.cx, p.y - c.cy);
  assert.ok(d <= c.r - p.radius + 0.6, `остался внутри круга: ${d.toFixed(2)}`);
  assert.ok(p.atEdge === true, 'персонаж отмечен как прижатый к кромке');
});

test('за кромкой круга нет ни земли, ни следа', () => {
  const { game, p } = arena({ mapW: 60, mapH: 60 });
  const g = game.grid, c = g.circle;
  place(p, c.cx + c.r - 2, c.cy, 0);
  driveAngle(game, 2, 0, 3);
  for (let i = 0; i < g.size; i++) {
    if (!g.wall[i]) continue;
    assert.equal(g.owner[i], 0, 'стена не может быть чьей-то землёй');
    assert.equal(g.trail[i], 0, 'в стене не бывает следа');
  }
});

test('проценты считаются от площади круга, а не прямоугольника', () => {
  const { game } = arena({ mapW: 100, mapH: 100 });
  const g = game.grid;
  const free = g.freeCells();
  assert.ok(free < g.size * 0.85, `круг занимает меньше прямоугольника: ${free}/${g.size}`);
  const area = Math.PI * g.circle.r * g.circle.r;
  assert.ok(Math.abs(free - area) / area < 0.03, `площадь круга совпадает: ${free} vs ${Math.round(area)}`);
  const cells = g.ownerCount(1);
  assert.ok(Math.abs(g.percent(1) - cells / free * 100) < 1e-9);
});

test('лобовое столкновение убивает обоих вне своей земли', () => {
  const { game, p } = arena();
  const q = game.addPlayer({ id: 2, isBot: false, name: 'Тест', x: 80.5, y: 80.5, angle: 0, skinId: 'robot', startSize: 7 });
  game.grid.releaseTerritory(2);
  place(p, 50, 50, 0);
  place(q, 51.4, 50.6, Math.PI);
  game.resolveHeadCollisions();
  assert.equal(p.alive, false);
  assert.equal(q.alive, false);
  assert.equal(p.deathCause, 'head');
});

test('на своей земле игрок неуязвим для лобового', () => {
  const { game, p } = arena();
  game.grid.claimRect(45, 45, 11, 11, 1);
  const q = game.addPlayer({ id: 2, isBot: false, name: 'Тест', x: 80.5, y: 80.5, angle: 0, skinId: 'robot', startSize: 7 });
  game.grid.releaseTerritory(2);
  place(p, 50.5, 50.5, 0);
  place(q, 51, 50.5, Math.PI);
  game.resolveHeadCollisions();
  assert.equal(p.alive, true);
  assert.equal(q.alive, true);
});

test('повторная команда тем же курсом не дёргает персонажа', () => {
  const { game, p } = arena();
  place(p, 50.5, 50.5, 0.4);
  const x0 = p.x, y0 = p.y;
  for (let i = 0; i < 30; i++) {
    game.steer(p.angle);
    game.step(DT);
  }
  assert.equal(p.alive, true);
  assert.ok(Math.abs(angNorm(p.angle - 0.4)) < 1e-6, 'курс не изменился');
  const moved = Math.hypot(p.x - x0, p.y - y0);
  assert.ok(moved > 5, `персонаж едет ровно: ${moved.toFixed(2)} клеток`);
});
