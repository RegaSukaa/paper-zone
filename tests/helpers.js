'use strict';
const path = require('path');
const core = require(path.join(__dirname, '..', 'src', 'core.js'));
const engine = require(path.join(__dirname, '..', 'src', 'engine.js'));

const { Grid, DIRS } = core;
const { Game } = engine;

/* Клетка по координатам — удобное сравнение наборов. */
function cellsOf(grid, list) {
  return list.map(i => [i % grid.w, Math.floor(i / grid.w)]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/* След по прямой линии (для тестов захвата, без симуляции движения). */
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

/* Гоняем игрока в одном направлении, пока не пройдёт n клеток или не умрёт. */
function walk(game, playerId, dir, n) {
  const p = game.playerById(playerId);
  const sx = p.cx, sy = p.cy;
  game.setDirection(playerId, dir);
  let guard = 0;
  while (guard++ < 20000) {
    game.step(1 / 60);
    if (!p.alive) break;
    if (Math.abs(p.cx - sx) + Math.abs(p.cy - sy) >= n) break;
  }
  return p;
}

/* Управляемая арена: игрок + пустая карта, территория задаётся вручную. */
function arena(opts = {}) {
  const g = new Game(Object.assign({
    mode: 'free', botCount: 0, mapW: 40, mapH: 40, seed: 7, difficulty: 'medium', speed: 11
  }, opts));
  const p = g.human;
  g.grid.releaseTerritory(1);
  return { game: g, p };
}

module.exports = { core, engine, Grid, Game, DIRS, cellsOf, drawTrail, walk, arena, require };
