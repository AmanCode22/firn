// Back from being minimized, Firn draws what's on screen again: the page
// (which could stay blank until something changed, a known Electron
// problem on Windows) and its own layers, once right away and once the
// window has settled.
const { _electron } = require('./playwright.cjs');
const ROOT = require('path').resolve(__dirname, '../..');
const { execSync } = require('child_process');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
(async () => {
  execSync('rm -f /root/.config/Firn/session.json');
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: require('path').join(
      ROOT,
      'node_modules/electron/dist/electron',
    ),
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  await ui.click('.new-tab');
  await wait(300);
  await fl.keyboard.type('127.0.0.1:8765/red.html');
  await fl.keyboard.press('Enter');
  await wait(1500);

  // Count each redraw Firn asks for, then bring the window back.
  const counts = await app.evaluate(async ({ BrowserWindow, webContents }) => {
    const seen = new Map();
    for (const web of webContents.getAllWebContents()) {
      const draw = web.invalidate.bind(web);
      web.invalidate = () => {
        seen.set(web.getURL(), (seen.get(web.getURL()) ?? 0) + 1);
        draw();
      };
    }
    BrowserWindow.getAllWindows()[0].emit('restore');
    await new Promise((r) => setTimeout(r, 400));
    return Object.fromEntries(seen);
  });
  const page = Object.entries(counts).find(([u]) => u.includes('red.html'));
  const sidebar = Object.entries(counts).find(([u]) => u.endsWith(':5173/'));
  check(
    'back from minimized: the page on screen is drawn again, twice',
    page?.[1] === 2,
    JSON.stringify(counts),
  );
  check("...and Firn's own sidebar too", (sidebar?.[1] ?? 0) >= 1);
  const hidden = Object.entries(counts).filter(
    ([u]) => u.startsWith('http://127.0.0.1') && !u.includes('red.html'),
  );
  check('...but not pages that are out of sight', hidden.length === 0);

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
