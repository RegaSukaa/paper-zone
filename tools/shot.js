/* tools/shot.js — снимки экрана для документации и отчёта.
 *   node tools/shot.js
 * Два прогона headless Edge: меню и живой матч (скрипт на странице сразу
 * запускает игру и ведёт указатель по кругу).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs');
const BROWSER = process.env.PZ_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const playScript = `
<script>
(function () {
  function start() {
    var PZ = window.__PZ;
    if (!PZ) { return; }
    document.getElementById('btn-play').click();
    var t0 = performance.now();
    setInterval(function () {
      var PZ2 = window.__PZ;
      if (!PZ2 || !PZ2.game || !PZ2.game.human) return;
      var h = PZ2.game.human;
      var head = PZ2.renderer.worldToScreen(h.x, h.y);
      var a = (performance.now() - t0) / 1000 * 1.15;
      var px = head.x + Math.cos(a) * 190;
      var py = head.y + Math.sin(a) * 190;
      window.dispatchEvent(new PointerEvent('pointermove', {
        pointerType: 'mouse', clientX: px, clientY: py, bubbles: true
      }));
    }, 70);
  }
  document.addEventListener('DOMContentLoaded', function () { start(); });
})();
</script>`;

function build(name, inject) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const out = path.join(root, name);
  fs.writeFileSync(out, inject ? html.replace('</body>', inject + '\n</body>') : html, 'utf8');
  return out;
}

function shot(pageFile, file, size, budget) {
  const target = path.join(outDir, file);
  try { fs.unlinkSync(target); } catch (e) {}
  const profile = path.join(os.tmpdir(), 'pz-shot-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
  try {
    execFileSync(BROWSER, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--allow-file-access-from-files', '--hide-scrollbars', '--mute-audio',
      '--window-size=' + size,
      '--user-data-dir=' + profile,
      '--virtual-time-budget=' + budget,
      '--screenshot=' + target,
      'file:///' + pageFile.replace(/\\/g, '/')
    ], { stdio: 'ignore', timeout: 180000 });
  } catch (e) {
    console.log('снимок не удался: ' + file + ' — ' + e.message);
  } finally {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  if (fs.existsSync(target)) {
    console.log(file + ': ' + Math.round(fs.statSync(target).size / 1024) + ' КБ');
  } else {
    console.log(file + ': файла нет');
  }
}

fs.mkdirSync(outDir, { recursive: true });
const menuPage = build('_shot_menu.html');
const gamePage = build('_shot_game.html', playScript);

shot(menuPage, 'screen-menu.png', '1280,800', 5000);
shot(gamePage, 'screen-game.png', '1000,650', 4000);
shot(menuPage, 'screen-mobile.png', '420,900', 5000);

for (const f of [menuPage, gamePage]) {
  try { fs.unlinkSync(f); } catch (e) {}
}
