// The top edge on Windows and Linux ("In the sidebar"): the top bar comes
// down only when the mouse rests against the window's very top, never for
// a site's own search box up there (the Azure portal's), nor a flick past
// it. And a bar sliding away when a setting changes still goes away (it
// used to stay, unseen, and on Windows its drag band caught the page's
// clicks).
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
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  await ui.click('.new-tab');
  await wait(300);
  await fl.keyboard.type('127.0.0.1:8765/topsearch.html');
  await fl.keyboard.press('Enter');
  await wait(1500);
  const pg = app.windows().find((w) => w.url().includes('topsearch'));

  // Like a maximized window on Windows: the window reaches a little past
  // the screen's top, so the page itself touches it.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const b = w.getContentBounds();
    w.setContentBounds({ ...b, x: 20, y: -8 });
  });
  await wait(600);
  const info = () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const kids = w.contentView.children;
      const page = kids.find((v) =>
        v.webContents?.getURL().includes('topsearch'),
      );
      const bar = kids.find((v) =>
        v.webContents?.getURL().includes('view=topbar'),
      );
      return {
        content: w.getContentBounds(),
        page: page.getBounds(),
        bar: bar.getVisible() && bar.getBounds().height > 0,
      };
    });
  const at = await info();
  const box = await pg.evaluate(() => {
    const r = search.getBoundingClientRect();
    return { x: r.x + r.width / 2, top: r.y, bottom: r.bottom };
  });
  const screenX = at.content.x + at.page.x + box.x;
  const screenY = (y) => at.content.y + at.page.y + y;
  check('the page reaches the screen top', screenY(0) <= 0, JSON.stringify(at));

  // Up to the top of the search box, from lower on the page.
  mouse('move', screenX, screenY(200));
  await wait(200);
  for (let i = 1; i <= 8; i++) {
    mouse(
      'move',
      screenX,
      Math.round(screenY(200) - (200 - box.top - 1) * (i / 8)),
    );
    await wait(30);
  }
  await wait(700);
  check(
    "resting on the site's own search box: no top bar",
    !(await info()).bar,
  );
  mouse('down');
  mouse('up');
  await wait(300);
  await pg.keyboard.type('hello');
  await wait(300);
  const typed = await pg.evaluate(() => search.value);
  check(
    'the search box takes the click and the typing',
    typed === 'hello',
    typed,
  );

  // A flick to the screen's very top and straight back down.
  mouse('move', screenX, 0);
  await wait(100);
  mouse('move', screenX, screenY(20));
  await wait(600);
  check('a flick past the top edge: no top bar', !(await info()).bar);

  // Resting against the top edge brings it.
  mouse('move', screenX, 0);
  await wait(700);
  const shown = await info();
  check(
    'resting at the very top: the bar comes down, the page below it',
    shown.bar && shown.page.y === 40,
    JSON.stringify(shown.page),
  );

  // Leave, and change a setting just as the bar starts sliding away.
  mouse('move', screenX, screenY(300));
  for (let i = 0; i < 40 && (await info()).page.y === 40; i++) await wait(20);
  await ui.evaluate(() => window.firn.updateSettings({ archiveAfter: 30 }));
  await wait(800);
  const after = await info();
  check(
    'a setting changing while the bar slides away: it still goes',
    !after.bar && after.page.y === 8,
    JSON.stringify(after),
  );

  await ui.evaluate(() => window.firn.updateSettings({ archiveAfter: 7 }));
  await wait(300);
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
