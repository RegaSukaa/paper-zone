'use strict';
const path = require('path');
const core = require(path.join(__dirname, '..', 'src', 'core.js'));
const skins = require(path.join(__dirname, '..', 'src', 'skins.js'));
const engine = require(path.join(__dirname, '..', 'src', 'engine.js'));

const { Grid, DIRS, PHYS, angNorm } = core;
const { Game } = engine;

/* Управляемая арена: пустая карта, известная территория, без ботов. */
function arena(opts = {}) {
  const g = new Game(Object.assign({
    mode: 'free', botCount: 0, mapW: 100, mapH: 100, seed: 7, speed: PHYS.speed
  }, opts));
  const p = g.human;
  g.grid.releaseTerritory(1);
  return { game: g, p };
}

/* Поставить игрока в точку с заданным курсом. */
function place(p, x, y, angle) {
  p.x = x; p.y = y;
  if (angle !== undefined) { p.angle = angle; p.wantAngle = angle; }
}

/* Ехать к точке, плавно поворачивая (как игрок мышью). */
function driveTo(game, id, tx, ty, maxSeconds = 6, stopAt = 2.2) {
  const p = game.playerById(id);
  const dt = 1 / 60;
  for (let t = 0; t < maxSeconds; t += dt) {
    if (!p.alive) return false;
    game.setTargetAngle(id, Math.atan2(ty - p.y, tx - p.x));
    game.step(dt);
    if (Math.hypot(tx - p.x, ty - p.y) <= stopAt) return true;
  }
  return false;
}

/* Ехать с постоянным курсом n секунд. */
function driveAngle(game, id, angle, seconds) {
  const dt = 1 / 60;
  game.setTargetAngle(id, angle);
  for (let t = 0; t < seconds; t += dt) game.step(dt);
  return game.playerById(id);
}

/* Все клетки следа игрока. */
function trailCells(game, id) {
  const g = game.grid;
  const out = [];
  for (let i = 0; i < g.size; i++) if (g.trail[i] & core.bitOf(id)) out.push(i);
  return out;
}

/* 4-связность клеток следа: проверка отсутствия разрывов. */
function isConnected(game, cells) {
  if (cells.length < 2) return true;
  const g = game.grid;
  const set = new Set(cells);
  const seen = new Set([cells[0]]);
  const queue = [cells[0]];
  while (queue.length) {
    const i = queue.pop();
    const x = i % g.w, y = Math.floor(i / g.w);
    const neighbours = [];
    if (x > 0) neighbours.push(i - 1);
    if (x < g.w - 1) neighbours.push(i + 1);
    if (y > 0) neighbours.push(i - g.w);
    if (y < g.h - 1) neighbours.push(i + g.w);
    for (const j of neighbours) {
      if (set.has(j) && !seen.has(j)) { seen.add(j); queue.push(j); }
    }
  }
  return seen.size === set.size;
}

function hashGame(game) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < game.grid.owner.length; i++) {
    h ^= game.grid.owner[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  for (const p of game.players) {
    h ^= (Math.floor(p.x * 100) * 31 + Math.floor(p.y * 100)) | 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

module.exports = {
  core, skins, engine, Grid, Game, DIRS, PHYS, angNorm,
  arena, place, driveTo, driveAngle, trailCells, isConnected, hashGame
};
