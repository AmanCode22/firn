// Two glides at once: hiding the sidebar while the address bar moves to
// the top slides the page's left and top edges together. Each glide holds
// the site's layout for itself, so the site keeps one layout until both
// have ended (one ending used to let go of the other's hold), then fits.
const { _electron } = require('./playwright.cjs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
(async () => {
  require('child_process').execSync('rm -f /root/.config/Firn/session.json');
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  await ui.evaluate(() =>
    window.firn.updateSettings({ addressBar: 'sidebar' }),
  );
  await wait(600);
  await ui.click('.new-tab');
  await wait(300);
  await fl.keyboard.type('127.0.0.1:8765/red.html');
  await fl.keyboard.press('Enter');
  await wait(1500);

  // Where the page is, and the width the site lays itself out at.
  const sample = () =>
    app.evaluate(async ({ BrowserWindow }) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find(
        (c) =>
          c.webContents &&
          /8765/.test(c.webContents.getURL()) &&
          c.getVisible(),
      );
      const b = v.getBounds();
      return {
        x: b.x,
        y: b.y,
        w: b.width,
        layout: await v.webContents.executeJavaScript('innerWidth'),
      };
    });
  const start = await sample();
  // The sidebar starts sliding away; a moment later the top glide starts
  // (and, being later, ends later).
  await ui.evaluate(() => window.firn.runAction('sidebar', ''));
  await wait(60);
  await ui.evaluate(() => window.firn.updateSettings({ addressBar: 'top' }));
  const out = [];
  for (let i = 0; i < 40; i++) {
    out.push(await sample());
    await wait(8);
  }
  await wait(400);
  const end = await sample();
  const moving = out.filter(
    (s) => s.x !== end.x || s.y !== end.y || s.w !== end.w,
  );
  check(
    'both edges slide',
    start.x !== end.x && start.y !== end.y,
    `${JSON.stringify(start)} → ${JSON.stringify(end)}`,
  );
  check(
    'the site keeps one layout, the widest, while they slide',
    moving.length > 0 && moving.every((s) => s.layout === end.w),
    moving.map((s) => `${s.x},${s.y}:${s.layout}`).join(' '),
  );
  check(
    '...and fits the page once both have ended',
    end.layout === end.w,
    JSON.stringify(end),
  );

  // Back as it was (the settings file carries over to other checks).
  await ui.evaluate(() =>
    window.firn.updateSettings({ addressBar: 'sidebar' }),
  );
  await wait(400);
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
