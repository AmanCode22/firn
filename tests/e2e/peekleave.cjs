// The peeking sidebar tucks away once the mouse leaves the window (below
// it, onto the taskbar, or off to its left onto the desktop), with a real
// (system) mouse; a small slip past the left edge still keeps it out.
// (It used to stay out anywhere within 200px of the window.)
const { _electron } = require('./playwright.cjs');
const { execSync } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mouse = (...a) =>
  execSync(`python3 ${__dirname}/xmouse.py ${a.join(' ')}`);
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
  const pk = app.windows().find((w) => w.url().includes('view=peek'));
  // A window in the middle of the screen, with room around it.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentBounds({
      x: 300,
      y: 100,
      width: 900,
      height: 600,
    });
  });
  await wait(600);
  const o = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getContentBounds(),
  );
  await ui.click('.sidebar-top button[data-tip^="Hide sidebar"]');
  await wait(800);
  const pageX = await app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find(
      (v) => !v.webContents.getURL().includes('5173') && v.getVisible(),
    );
    return v && v.getBounds().x;
  });
  check('the sidebar is hidden', pageX === 8, String(pageX));
  const shown = () =>
    pk.evaluate(() =>
      document.querySelector('.peek').classList.contains('is-shown'),
    );
  const peekOut = async () => {
    mouse('move', o.x + 300, o.y + 300);
    await wait(300);
    mouse('move', o.x + 4, o.y + 300);
    await wait(500);
    return shown();
  };

  check('the left edge brings it out', await peekOut(), JSON.stringify(o));
  mouse('move', o.x + 100, o.y + 300);
  await wait(300);
  mouse('move', o.x + 100, o.y + o.height + 80);
  await wait(900);
  check('it tucks away once the mouse goes below the window', !(await shown()));

  check('...out again', await peekOut());
  mouse('move', o.x - 120, o.y + 300);
  await wait(900);
  check('it tucks away once the mouse goes off to the left', !(await shown()));

  check('...out again', await peekOut());
  mouse('move', o.x - 10, o.y + 300);
  await wait(900);
  check('a small slip past the left edge keeps it out', await shown());

  // The sidebar back, for the checks after this one.
  await peekOut();
  await pk.click('.sidebar-top button[data-tip^="Keep sidebar open"]');
  await wait(800);
  await app.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
