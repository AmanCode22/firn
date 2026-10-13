// Back from being minimized, Firn draws what's on screen again: the page
// (which could stay blank until something changed, a known Electron
// problem on Windows) and its own layers, once right away and once the
// window has settled, nudging the page's size by a pixel and handing its
// view to the window again (on Windows only that last one, what a tab switch
// does, brought it back), with Firn's own layers lifted back above it.
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
    await new Promise((r) => setTimeout(r, 700));
    return Object.fromEntries(seen);
  });
  const page = Object.entries(counts).find(([u]) => u.includes('red.html'));
  const sidebar = Object.entries(counts).find(([u]) => u.endsWith(':5173/'));
  check(
    'back from minimized: the page on screen is drawn again, three times',
    page?.[1] === 3,
    JSON.stringify(counts),
  );
  check("...and Firn's own sidebar too", (sidebar?.[1] ?? 0) >= 1);
  const hidden = Object.entries(counts).filter(
    ([u]) => u.startsWith('http://127.0.0.1') && !u.includes('red.html'),
  );
  check('...but not pages that are out of sight', hidden.length === 0);

  // A redraw alone isn't always enough on Windows: the page is also made a
  // pixel shorter for a moment, then put back exactly.
  const heights = await app.evaluate(async ({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find(
      (v) => v.webContents?.getURL().includes('red.html'),
    );
    const seen = [view.getBounds().height];
    BrowserWindow.getAllWindows()[0].emit('restore');
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 10));
      const h = view.getBounds().height;
      if (h !== seen.at(-1)) seen.push(h);
    }
    await new Promise((r) => setTimeout(r, 300));
    seen.push(view.getBounds().height);
    return seen;
  });
  check(
    '...its size nudged by a pixel and put back',
    heights.length >= 3 &&
      heights[1] === heights[0] - 1 &&
      heights.at(-1) === heights[0],
    heights.join(' → '),
  );

  // (With the command bar open, so a layer is shown over the page.)
  await ui.click('.new-tab');
  await wait(400);
  // The page's view is handed to the window again (it moves to the top of
  // the window's views), and Firn's shown layers end up above it again.
  const order = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const names = () =>
      win.contentView.children.map((v) => {
        const url = v.webContents?.getURL() ?? '';
        return url.includes('red.html')
          ? 'page'
          : url.includes('view=')
            ? url.split('view=')[1].split('&')[0]
            : url.endsWith(':5173/')
              ? 'sidebar'
              : 'other';
      });
    const index = (list) => list.indexOf('page');
    const before = names();
    // Something else on top first, so a hand-back shows as a move.
    const other = win.contentView.children.find(
      (v) => !(v.webContents?.getURL() ?? '').includes('red.html'),
    );
    win.contentView.addChildView(other);
    const moved = index(names());
    win.emit('restore');
    await new Promise((r) => setTimeout(r, 50));
    const after = names();
    const page = win.contentView.children.find((v) =>
      v.webContents?.getURL().includes('red.html'),
    );
    return { before, moved, after, visible: page.getVisible() };
  });
  check(
    "...the page's view handed to the window again, still shown",
    order.after.indexOf('page') > order.moved && order.visible,
    JSON.stringify(order),
  );
  check(
    '(the command bar was open over the page)',
    order.before.indexOf('floating') > order.before.indexOf('page'),
  );
  const shownLayers = order.before
    .slice(order.before.indexOf('page') + 1)
    .filter((n) => n !== 'other');
  check(
    "...with Firn's layers that were above it still above it",
    shownLayers.every(
      (n) => order.after.indexOf(n) > order.after.indexOf('page'),
    ),
    JSON.stringify(shownLayers),
  );
  await fl.keyboard.press('Escape');
  await wait(300);

  // Brought back without a 'restore' (it doesn't always come for a frameless
  // window): the edge watch, once a second while minimized, notices.
  const quiet = await app.evaluate(async ({ BrowserWindow, webContents }) => {
    const win = BrowserWindow.getAllWindows()[0];
    let draws = 0;
    for (const web of webContents.getAllWebContents())
      if (web.getURL().includes('red.html')) {
        const draw = web.invalidate.bind(web);
        web.invalidate = () => {
          draws++;
          draw();
        };
      }
    win.emit('minimize');
    await new Promise((r) => setTimeout(r, 1800));
    return draws;
  });
  check(
    "back without a 'restore': still drawn again",
    quiet >= 1,
    String(quiet),
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
