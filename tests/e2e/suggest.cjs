// Search suggestions in the command bar. Nothing is sent until the person
// says yes (asked once in the command bar, unless the welcome asked); then
// the engine's suggestions show under what's typed, never for something
// that looks like an address, and without cookies. Off in Settings, nothing
// is sent again. FIRN_SUGGEST_TEST points Firn at this test's own server.
const { _electron } = require('./playwright.cjs');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const SETTINGS = '/root/.config/Firn/settings.json';
const SP = process.env.SP;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
const asked = []; // what Firn sent: { q, cookie }
const server = http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/cookie') {
      res.writeHead(200, {
        'Set-Cookie': 'signedin=yes; Path=/',
        'Content-Type': 'text/html',
      });
      return res.end('<title>Cookie</title>');
    }
    if (url.pathname !== '/suggest') {
      res.writeHead(404);
      return res.end();
    }
    const q = url.searchParams.get('q') ?? '';
    asked.push({ q, cookie: req.headers.cookie ?? '' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([q, [`${q} trails`, `${q} lakes`, q]]));
  })
  .listen(8768);
const setSetting = (value) => {
  const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  s.searchSuggestions = value;
  fs.writeFileSync(SETTINGS, JSON.stringify(s));
};
(async () => {
  execSync('rm -f /root/.config/Firn/session.json');
  setSetting('ask');
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    env: {
      ...process.env,
      FIRN_SUGGEST_TEST: 'http://127.0.0.1:8768/suggest?q=',
    },
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  const o = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getContentBounds(),
  );
  const shot = (name) =>
    execSync(
      `import -window root -crop ${o.width}x${o.height}+${o.x}+${o.y} ${SP}/${name}.png`,
    );
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  // A cookie for the "engine", as if signed in there.
  await ui.evaluate(() => window.firn.openUrl('127.0.0.1:8768/cookie'));
  await wait(1200);

  const rows = () =>
    fl.evaluate(() =>
      [...document.querySelectorAll('.result.is-suggest .result-title')].map(
        (r) => r.textContent,
      ),
    );
  const askShown = () =>
    fl.evaluate(() => !!document.querySelector('[data-testid="suggest-ask"]'));
  const type = async (text) => {
    await ui.click('.new-tab');
    await wait(400);
    await fl.keyboard.type(text, { delay: 40 });
    await wait(900);
  };

  await type('glacier');
  shot('suggest-ask');
  check(
    'not answered yet: the command bar asks once, and nothing is sent',
    (await askShown()) && asked.length === 0,
    `asked: ${asked.length}`,
  );
  await fl.click(
    '[data-testid="suggest-ask"] button:has-text("Show suggestions")',
  );
  await wait(600);
  check(
    '"Show suggestions" is saved, and the question goes',
    JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).searchSuggestions === 'on' &&
      !(await askShown()),
  );
  await fl.keyboard.type(' ice', { delay: 40 });
  await wait(900);
  let r = await rows();
  shot('suggest-on');
  check(
    "on: the engine's suggestions show under what's typed (not the typed text again)",
    r.join('|') === 'glacier ice trails|glacier ice lakes',
    r.join('|'),
  );
  check(
    '...asked once typing paused, not for every letter',
    asked.length >= 1 && asked.length <= 2,
    asked.map((a) => a.q).join(' / '),
  );
  check(
    '...and sent without cookies',
    asked.every((a) => a.cookie === ''),
    JSON.stringify(asked.map((a) => a.cookie)),
  );
  await fl.click('.result.is-suggest >> nth=0');
  await wait(1500);
  const opened = await app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().map((w) => w.getURL()),
  );
  check(
    'clicking one searches for it',
    opened.some((u) => u.includes('glacier%20ice%20trails')),
    opened.filter((u) => u.includes('glacier')).join(', '),
  );

  let before = asked.length;
  await type('127.0.0.1:8765/red');
  check(
    'something that looks like an address is never sent',
    asked.length === before && (await rows()).length === 0,
    asked
      .slice(before)
      .map((a) => a.q)
      .join(' / '),
  );
  await fl.keyboard.press('Escape');
  await wait(300);

  await ui.evaluate(() =>
    window.firn.updateSettings({ searchSuggestions: 'off' }),
  );
  await wait(300);
  before = asked.length;
  await type('moraine');
  check(
    'off: nothing sent, no suggestions, and no question',
    asked.length === before &&
      (await rows()).length === 0 &&
      !(await askShown()),
    `asked: ${asked.length - before}`,
  );
  await fl.keyboard.press('Escape');

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
  server.close();
  // Back as it was (the settings file carries over to other checks).
  setSetting('ask');
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
