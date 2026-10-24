const { Game } = require('../src/engine.js');

const game = new Game({ mode: 'free', mapW: 120, mapH: 120, seed: 3, difficulty: 'medium', autopilot: true, botCount: 3 });
const log = [];
let steps = 0;
while (game.time < 8 && game.state === 'playing' && steps < 600) {
  game.step(1 / 60);
  steps++;
  if (steps % 6 === 0) {
    log.push(game.players.map(p => {
      if (!p.alive) return 'x';
      return p.id + ':' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ' a' + p.angle.toFixed(2) +
        ' tr' + p.trail.size + ' st' + (p.bot ? p.bot.state : '-');
    }).join(' | '));
  }
  for (const ev of game.drainEvents()) {
    if (ev.type === 'death') {
      console.log('DEATH', ev.cause, 'id', ev.id, 't', game.time.toFixed(2), 'at', ev.x.toFixed(1), ev.y.toFixed(1));
      console.log(log.slice(-16).join('\n'));
      process.exit(0);
    }
  }
}
console.log('ничего не случилось');
