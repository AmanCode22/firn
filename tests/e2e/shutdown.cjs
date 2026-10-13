// Windows shutting down ('session-end', pretended here): Firn saves at
// once, so a tab opened a moment before is still there next time.
const { _electron } = require('./playwright.cjs');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const SESSION = '/root/.config/Firn/session.json';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
(async () => {
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  const saved = () => {
    try {
      return fs.readFileSync(SESSION, 'utf8');
    } catch {
      return '';
    }
  };
  // Open a tab, and pretend Windows shuts down right away, before Firn's
  // usual save (within 2 seconds) gets to it. (If that save happens to come
  // first, try again with another tab.)
  const pages = ['green.html', 'blue.html', 'red.html', 'gray.html'];
  let caught = null;
  for (const page of pages) {
    await wait(2500);
    await ui.click('.new-tab');
    await wait(300);
    await fl.keyboard.type(`127.0.0.1:8765/${page}`);
    await fl.keyboard.press('Enter');
    await wait(200);
    if (saved().includes(page)) continue;
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].emit('session-end'),
    );
    caught = { page, saved: saved().includes(page) };
    break;
  }
  check(
    'Windows shutting down: the session is saved right away',
    !!caught?.saved,
    JSON.stringify(caught),
  );
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
