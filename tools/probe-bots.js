const { Game } = require('../src/engine.js');

for (const level of ['easy', 'medium', 'hard']) {
  const game = new Game({ mode: 'classic', mapW: +(process.env.W||140), mapH: +(process.env.W||140), botCount: +(process.env.B||5), seed: 2026, difficulty: level, autopilot: true });
  const causes = {};
  let steps = 0;
  const marks = [];
  while (game.time < 45 && game.state === 'playing' && steps < 46 * 60) {
    game.step(1 / 60);
    steps++;
    for (const ev of game.drainEvents()) {
      if (ev.type === 'death') {
        causes[ev.cause] = (causes[ev.cause] || 0) + 1;
        marks.push(ev.cause + '@' + game.time.toFixed(0));
      }
    }
  }
  const alive = game.players.filter(p => p.alive);
  const total = alive.reduce((s, p) => s + game.grid.ownerCount(p.id), 0);
  console.log(level, JSON.stringify(causes), marks.join(' '), 'alive', alive.length, 'total', total, 'time', game.time.toFixed(0));
  console.log('  ', game.players.map(p => `id${p.id}${p.isBot ? 'b' : ''}:${p.alive ? game.grid.ownerCount(p.id) : '×'}`).join(' '));
}
