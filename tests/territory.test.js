'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Grid } = require('../src/core.js');

/* Рисуем «след» прямо в сетке: тесты проверяют алгоритм заливки, а не физику. */
function drawTrail(grid, id, points) {
  for (let k = 1; k < points.length; k++) {
    const [x0, y0] = points[k - 1];
    const [x1, y1] = points[k];
    const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    let x = x0, y = y0;
    grid.addTrailAt(x, y, id);
    while (x !== x1 || y !== y1) {
      x += dx; y += dy;
      grid.addTrailAt(x, y, id);
    }
  }
}

function ownedBy(grid, id) {
  const out = [];
  for (let i = 0; i < grid.size; i++) if (grid.owner[i] === id) out.push(i);
  return out;
}

test('простой квадратный контур закрашивает только внутренность', () => {
  const g = new Grid(20, 20, 8);
  g.claimRect(0, 0, 1, 20, 1); // своя полоса слева
  drawTrail(g, 1, [[1, 5], [8, 5], [8, 10], [1, 10], [1, 5]]);
  const res = g.closeTrail(1);

  assert.equal(res.enclosed.length, 24, 'внутри рамки 6x4 = 24 клетки');
  // проверяем адресно каждую клетку внутренности
  for (let y = 6; y <= 9; y++) {
    for (let x = 2; x <= 7; x++) {
      assert.equal(g.ownerAt(x, y), 1, `клетка ${x},${y} должна быть захвачена`);
    }
  }
  // снаружи ничего не залито
  assert.equal(g.ownerAt(9, 7), 0);
  assert.equal(g.ownerAt(4, 4), 0);
  assert.equal(g.ownerAt(4, 11), 0);
  // след превратился в территорию
  assert.equal(g.ownerAt(1, 5), 1);
  assert.equal(g.ownerAt(8, 10), 1);
  assert.equal(g.trailAt(8, 10), 0, 'след очищен');
  assert.equal(g.trailLength(1), 0);
  assert.equal(g.ownerCount(1), 20 + 24 + 24);
  assert.equal(ownedBy(g, 1).length, 68);
});

test('вогнутый контур: L-образная фигура', () => {
  const g = new Grid(24, 24, 8);
  g.claimRect(0, 0, 1, 24, 1);
  // выходим вправо, вниз, вправо, вниз, затем обратно к своей полосе
  drawTrail(g, 1, [[1, 3], [12, 3], [12, 8], [18, 8], [18, 14], [1, 14], [1, 3]]);
  const res = g.closeTrail(1);

  // внутренность: x=2..11, y=4..13 (10x10) плюс выступ x=12..17, y=9..13 (6x5)
  const expected = (10 * 10) + (6 * 5);
  assert.equal(res.enclosed.length, expected);
  assert.equal(g.ownerAt(6, 8), 1);
  assert.equal(g.ownerAt(2, 8), 1, 'клетка на уровне низа первой вертикали внутри');
  assert.equal(g.ownerAt(12, 10), 1, 'клетка под вертикалью следа входит в контур');
  assert.equal(g.ownerAt(15, 11), 1);
  // угол, который не входит в контур
  assert.equal(g.ownerAt(15, 5), 0, 'клетка над выступом остаётся нейтральной');
  assert.equal(g.ownerAt(2, 15), 0, 'клетка под контуром не захвачена');
});

test('маленький захват: одна клетка', () => {
  const g = new Grid(12, 12, 8);
  g.claimRect(0, 0, 1, 12, 1);
  drawTrail(g, 1, [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]);
  const res = g.closeTrail(1);
  assert.equal(res.enclosed.length, 1, 'внутри рамки 3x3 свободна одна клетка 2,2');
  assert.equal(g.ownerAt(2, 2), 1);
  assert.equal(g.ownerAt(2, 4), 0);
});

test('большой захват: 40x40', () => {
  const g = new Grid(50, 50, 8);
  g.claimRect(0, 0, 3, 50, 1);
  drawTrail(g, 1, [[3, 3], [44, 3], [44, 44], [3, 44], [3, 3]]);
  const res = g.closeTrail(1);
  assert.equal(res.enclosed.length, 40 * 40);
  assert.equal(g.ownerAt(43, 43), 1);
  assert.equal(g.ownerAt(45, 45), 0);
  assert.equal(g.ownerAt(2, 2), 1);
});

test('замыкание у края карты', () => {
  const g = new Grid(16, 16, 8);
  g.claimRect(0, 0, 1, 16, 1);
  drawTrail(g, 1, [[1, 0], [6, 0], [6, 6], [1, 6], [1, 0]]);
  const res = g.closeTrail(1);
  assert.equal(res.enclosed.length, 4 * 5);
  for (let y = 1; y <= 5; y++) {
    for (let x = 2; x <= 5; x++) assert.equal(g.ownerAt(x, y), 1, `${x},${y}`);
  }
  assert.equal(g.ownerAt(1, 3), 1, 'след у самого края стал землёй');
  assert.equal(g.ownerAt(6, 7), 0);
});

test('повторное добавление клетки следа не дублируется', () => {
  const g = new Grid(10, 10, 8);
  assert.equal(g.addTrailAt(3, 3, 1), true);
  assert.equal(g.addTrailAt(3, 3, 1), false);
  assert.equal(g.trailLength(1), 1);
  g.clearTrail(1);
  assert.equal(g.trailAt(3, 3), 0);
  assert.equal(g.trailLength(1), 0);
});

test('самопересечение: клетка следа принадлежит двум игрокам одновременно', () => {
  const g = new Grid(14, 14, 8);
  g.addTrailAt(5, 5, 1);
  g.addTrailAt(5, 5, 2);
  assert.equal(g.hasTrailAt(5, 5, 1), true);
  assert.equal(g.hasTrailAt(5, 5, 2), true);
  g.clearTrail(1);
  assert.equal(g.hasTrailAt(5, 5, 1), false);
  assert.equal(g.hasTrailAt(5, 5, 2), true, 'след второго игрока не пострадал');
});

test('отсутствие дыр и случайно залитых областей', () => {
  const g = new Grid(30, 30, 8);
  g.claimRect(2, 2, 4, 4, 1);
  drawTrail(g, 1, [[2, 6], [10, 6], [10, 16], [2, 16], [2, 6]]);
  const res = g.closeTrail(1);
  const enclosed = new Set(res.enclosed);
  // каждая клетка внутренности попала в результат ровно один раз
  assert.equal(enclosed.size, res.enclosed.length);
  for (let y = 7; y <= 15; y++) {
    for (let x = 3; x <= 9; x++) {
      assert.ok(enclosed.has(g.idx(x, y)), `клетка ${x},${y} внутри должна быть в результате`);
    }
  }
  // ни одна клетка снаружи не попала
  for (let y = 0; y < 30; y++) {
    for (let x = 0; x < 30; x++) {
      const inside = x >= 2 && x <= 10 && y >= 6 && y <= 16;
      const inTerritory = x >= 2 && x <= 5 && y >= 2 && y <= 5;
      if (!inside && !inTerritory) {
        assert.equal(g.ownerAt(x, y), 0, `клетка ${x},${y} снаружи осталась нейтральной`);
      }
    }
  }
});

test('перехват чужой территории и корректный пересчёт площадей', () => {
  const g = new Grid(20, 20, 8);
  g.claimRect(0, 0, 1, 20, 1);
  g.claimRect(4, 6, 3, 3, 2); // враг внутри будущего контура
  assert.equal(g.ownerCount(2), 9);
  drawTrail(g, 1, [[1, 5], [8, 5], [8, 10], [1, 10], [1, 5]]);
  g.closeTrail(1);
  assert.equal(g.ownerAt(4, 6), 1, 'внутренняя чужая клетка перешла игроку');
  assert.equal(g.ownerCount(2), 0);
  assert.equal(g.ownerCount(1), 20 + 24 + 24);
});

test('процент территории считается от свободных клеток', () => {
  const g = new Grid(10, 10, 8);
  g.claimRect(0, 0, 5, 5, 1);
  assert.equal(g.ownerCount(1), 25);
  assert.ok(Math.abs(g.percent(1) - 25) < 1e-9);
  g.setWall(9, 9, true);
  assert.equal(g.freeCells(), 99);
  assert.ok(Math.abs(g.percent(1) - (25 / 99) * 100) < 1e-9, 'стена вычитается из знаменателя');
  g.setWall(9, 9, false);
  assert.ok(Math.abs(g.percent(1) - 25) < 1e-9);
});

test('процент не начисляется повторно при повторном захвате', () => {
  const g = new Grid(20, 20, 8);
  g.claimRect(0, 0, 1, 20, 1);
  drawTrail(g, 1, [[1, 5], [8, 5], [8, 10], [1, 10], [1, 5]]);
  g.closeTrail(1);
  const first = g.ownerCount(1);
  // второй проход по тем же клеткам (след кладём заново) не должен изменить счёт
  drawTrail(g, 1, [[1, 5], [8, 5], [8, 10], [1, 10], [1, 5]]);
  g.closeTrail(1);
  assert.equal(g.ownerCount(1), first);
});

test('два независимых захвата в одном шаге не мешают друг другу', () => {
  const g = new Grid(30, 30, 8);
  g.claimRect(0, 0, 1, 30, 1);
  g.claimRect(29, 0, 1, 30, 2);
  drawTrail(g, 1, [[1, 2], [6, 2], [6, 8], [1, 8], [1, 2]]);
  drawTrail(g, 2, [[28, 2], [24, 2], [24, 8], [28, 8], [28, 2]]);
  const t1 = g.trailLength(1);
  const t2 = g.trailLength(2);
  const r1 = g.closeTrail(1);
  const r2 = g.closeTrail(2);
  assert.equal(r1.enclosed.length, 4 * 5);
  assert.equal(r2.enclosed.length, 3 * 5);
  assert.equal(g.ownerAt(3, 5), 1);
  assert.equal(g.ownerAt(26, 5), 2);
  assert.equal(g.ownerCount(1), 30 + t1 + 20);
  assert.equal(g.ownerCount(2), 30 + t2 + 15);
});

test('контур, который не замыкается, ничего не захватывает', () => {
  const g = new Grid(20, 20, 8);
  g.claimRect(0, 0, 1, 20, 1);
  drawTrail(g, 1, [[1, 5], [9, 5], [9, 10]]);
  const res = g.closeTrail(1);
  assert.equal(res.enclosed.length, 0);
  assert.equal(g.ownerCount(1), 20 + 14, 'след всё равно становится землёй');
});

test('освобождение территории при смерти обнуляет счётчики', () => {
  const g = new Grid(12, 12, 8);
  g.claimRect(1, 1, 4, 4, 3);
  g.addTrailAt(6, 6, 3);
  assert.equal(g.ownerCount(3), 16);
  g.releaseTerritory(3);
  assert.equal(g.ownerCount(3), 0);
  assert.equal(g.trailLength(3), 0);
  assert.equal(g.ownerAt(2, 2), 0);
});
