/* tools/shot.js — снимки экрана через Chrome DevTools Protocol.
 * Обычный `--screenshot` срабатывает слишком рано (страница ещё на меню),
 * поэтому здесь мы подключаемся к headless-браузеру, сами запускаем матч,
 * ждём реальные секунды и снимаем кадр по CDP.
 *   node tools/shot.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs');
const BROWSER = process.env.PZ_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333 + (process.pid % 200);

const playScript = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    document.getElementById('btn-play').click();
    function key(code) { window.dispatchEvent(new KeyboardEvent('keydown', { code: code, key: code })); }
    setTimeout(function () {
      key('ArrowRight');
      setTimeout(function () { key('ArrowDown'); }, 700);
      setTimeout(function () { key('ArrowLeft'); }, 1400);
      setTimeout(function () { key('ArrowUp'); }, 2100);
      setTimeout(function () { key('ArrowRight'); }, 2700);
    }, 300);
  }, 400);
});
</script>`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function build(name, inject) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const out = path.join(root, name);
  fs.writeFileSync(out, inject ? html.replace('</body>', inject + '\n</body>') : html, 'utf8');
  return out;
}

async function getTarget(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await res.json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (e) { /* браузер ещё поднимается */ }
    await sleep(200);
  }
  throw new Error('не дождались CDP-таргета');
}

async function capture(pageUrl, file, width, height, waitMs, evaluate) {
  const profile = path.join(os.tmpdir(), 'pz-shot-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
  const child = spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--hide-scrollbars', '--mute-audio',
    '--window-size=' + width + ',' + height,
    '--user-data-dir=' + profile,
    '--remote-debugging-port=' + PORT,
    pageUrl
  ], { stdio: 'ignore' });

  let ws = null;
  try {
    const target = await getTarget();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
    function send(method, params) {
      return new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
      });
    }

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: pageUrl });
    await sleep(waitMs);
    if (evaluate) {
      const info = await send('Runtime.evaluate', { expression: evaluate, returnByValue: true });
      console.log('  состояние: ' + JSON.stringify(info.result && info.result.value));
    }
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const target2 = path.join(outDir, file);
    fs.writeFileSync(target2, Buffer.from(shot.data, 'base64'));
    console.log(file + ': ' + Math.round(fs.statSync(target2).size / 1024) + ' КБ');
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { child.kill(); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const menuPage = build('_shot_menu.html');
  const gamePage = build('_shot_game.html', playScript);
  const stateExpr = 'JSON.stringify({screen: window.__PZ.screen, percent: +window.__PZ.game.grid.percent(1).toFixed(2), time: +window.__PZ.game.time.toFixed(1)})';

  console.log('меню 1280×800');
  await capture('file:///' + menuPage.replace(/\\/g, '/'), 'screen-menu.png', 1280, 800, 1200);
  console.log('игра 1280×800');
  await capture('file:///' + gamePage.replace(/\\/g, '/'), 'screen-game.png', 1280, 800, 5200, stateExpr);
  console.log('мобильный 420×900');
  await capture('file:///' + menuPage.replace(/\\/g, '/'), 'screen-mobile.png', 420, 900, 1200);

  for (const f of [menuPage, gamePage]) {
    try { fs.unlinkSync(f); } catch (e) {}
  }
})().catch(e => {
  console.error('ошибка снимков: ' + e.message);
  process.exit(1);
});
