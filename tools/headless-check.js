/* ============================================================================
 * headless-check.js — интеграционная проверка игры в настоящем браузере.
 * Собирает копию index.html с внедрённым selftest.js, гоняет headless Edge
 * (или Chrome) в двух вьюпортах и печатает отчёт по каждой проверке.
 *
 *   node tools/headless-check.js [--keep]
 * ==========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const keep = process.argv.includes('--keep');

const BROWSERS = [
  process.env.PZ_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].filter(Boolean);

function findBrowser() {
  for (const p of BROWSERS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const collector = '<script>window.__errs=[];' +
  'addEventListener("error",function(e){window.__errs.push(String((e.error&&e.error.stack)||e.message||e));});' +
  'addEventListener("unhandledrejection",function(e){window.__errs.push("rejection: "+e.reason);});' +
  '</script>';

function buildPages() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  let test = html.replace('<script src="src/core.js"></script>',
    collector + '\n<script src="src/core.js"></script>');
  if (!test.includes('tools/selftest.js')) {
    test = test.replace('</body>', '<script src="tools/selftest.js"></script>\n</body>');
  }
  fs.writeFileSync(path.join(root, '_selftest.html'), test, 'utf8');

  const marker = "SELFTEST_" + "JSON:";
  const wrapper = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>selftest mobile</title>
<style>html,body{margin:0;background:#05070f;font:12px sans-serif;color:#fff}
iframe{width:390px;height:760px;border:0;display:block;margin:0 auto}</style></head>
<body>
<iframe id="f" src="_selftest.html"></iframe>
<script>
var tries = 0;
var timer = setInterval(function () {
  tries++;
  var rep = null;
  try {
    var w = document.getElementById('f').contentWindow;
    rep = w.__SELFTEST_REPORT || null;
  } catch (e) { rep = null; }
  if (rep) {
    clearInterval(timer);
    var pre = document.createElement('pre');
    pre.textContent = '${marker}' + JSON.stringify(rep);
    document.body.appendChild(pre);
    return;
  }
  if (tries > 900) {
    clearInterval(timer);
    var fail = document.createElement('pre');
    fail.textContent = '${marker}' + JSON.stringify({ ok: false, fatal: 'iframe report timeout', checks: [] });
    document.body.appendChild(fail);
  }
}, 50);
</script>
</body></html>`;
  fs.writeFileSync(path.join(root, '_selftest_mobile.html'), wrapper, 'utf8');
}

function extractReport(dom) {
  const marker = 'SELFTEST_JSON:';
  let idx = dom.lastIndexOf(marker);
  if (idx === -1) return null;
  const end = dom.indexOf('</pre>', idx);
  let raw = dom.slice(idx + marker.length, end === -1 ? undefined : end);
  raw = raw.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { ok: false, fatal: 'не удалось разобрать отчёт: ' + e.message, raw: raw.slice(0, 300) };
  }
}

function runHeadless(browser, page, windowSize) {
  const profile = path.join(os.tmpdir(), 'pz-profile-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    '--hide-scrollbars',
    '--mute-audio',
    '--window-size=' + (windowSize || '1366,900'),
    '--user-data-dir=' + profile,
    '--virtual-time-budget=45000',
    '--dump-dom',
    'file:///' + path.join(root, page).replace(/\\/g, '/')
  ];
  try {
    return execFileSync(browser, args, {
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      timeout: 240000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } finally {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}

function report(name, rep) {
  console.log('\n=== ' + name + ' ===');
  if (!rep) {
    console.log('  ОТЧЁТ НЕ НАЙДЕН');
    return false;
  }
  if (rep.fatal) console.log('  FATAL: ' + rep.fatal);
  if (rep.viewport) console.log('  viewport: ' + rep.viewport.w + '×' + rep.viewport.h + ' (dpr ' + rep.viewport.dpr + ')');
  const checks = rep.checks || [];
  for (const c of checks) {
    if (!c.pass) {
      console.log('  ✖ ' + c.name + (c.extra !== null && c.extra !== undefined ? '  → ' + JSON.stringify(c.extra) : ''));
    }
  }
  const pass = checks.filter(c => c.pass).length;
  console.log('  проверок: ' + pass + '/' + checks.length + (rep.ok ? ' — OK' : ' — ЕСТЬ ОШИБКИ'));
  if (process.env.PZ_VERBOSE || !rep.ok) {
    for (const c of checks) console.log('  ' + (c.pass ? '✔' : '✖') + ' ' + c.name);
  }
  return !!rep.ok;
}

function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error('Не найден Edge/Chrome. Укажите путь в переменной PZ_BROWSER.');
    process.exit(2);
  }
  console.log('Браузер: ' + browser);
  buildPages();

  let ok = true;
  const runs = [
    ['desktop', '_selftest.html', '1366,900'],
    ['mobile 390×760', '_selftest_mobile.html', '900,900']
  ];
  const only = process.env.PZ_ONLY;
  for (const [name, page, size] of runs) {
    if (only && !name.startsWith(only)) continue;
    try {
      const dom = runHeadless(browser, page, size);
      if (keep) fs.writeFileSync(path.join(root, '_dom_' + name.replace(/\W+/g, '_') + '.html'), dom, 'utf8');
      const rep = extractReport(dom);
      ok = report(name, rep) && ok;
    } catch (e) {
      ok = false;
      console.log('\n=== ' + name + ' ===');
      console.log('  ОШИБКА ЗАПУСКА: ' + e.message);
      if (e.stdout) console.log(String(e.stdout).slice(-2000));
    }
  }

  if (!keep) {
    for (const f of ['_selftest.html', '_selftest_mobile.html']) {
      try { fs.unlinkSync(path.join(root, f)); } catch (e) {}
    }
  } else {
    console.log('\nФайлы прогона оставлены: _selftest.html, _selftest_mobile.html, _dom_*.html');
  }

  console.log('\nИТОГ: ' + (ok ? 'все проверки пройдены' : 'есть падения'));
  process.exit(ok ? 0 : 1);
}

main();
