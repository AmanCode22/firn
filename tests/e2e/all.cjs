const { _electron } = require('./playwright.cjs');
const ROOT = require('path').resolve(__dirname, '../..');
const { execSync } = require('child_process');
const SP = process.env.SP;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const warp = (x, y) => execSync(`python3 ${__dirname}/warp.py ${x} ${y}`);
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`,
  );
};
(async () => {
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: require('path').join(
      ROOT,
      'node_modules/electron/dist/electron',
    ),
  });
  let out = '';
  app.process().stdout.on('data', (d) => (out += d));
  app.process().stderr.on('data', (d) => (out += d));
  const page = async (v) => {
    for (let i = 0; i < 100; i++) {
      const p = app
        .windows()
        .find((w) =>
          v ? w.url().includes('view=' + v) : w.url().endsWith(':5173/'),
        );
      if (p) return p;
      await wait(100);
    }
  };
  await wait(6000);
  const ui = await page(),
    fl = await page('floating'),
    pk = await page('peek'),
    tb = await page('topbar');
  const started = async (p) =>
    p.evaluate(() => {
      const r = document.getElementById('root');
      return (
        !!r && Object.keys(r).some((k) => k.startsWith('__reactContainer'))
      );
    });
  check(
    'all four panels started',
    (await Promise.all([ui, fl, pk, tb].map(started))).every(Boolean),
  );
  const o = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getContentBounds(),
  );
  // Like a real keyboard: each key event goes to whatever has focus right then.
  const ev = (type, keyCode, modifiers) =>
    app.evaluate(
      ({ webContents }, a) => {
        const w =
          webContents.getFocusedWebContents() ||
          webContents.getAllWebContents()[0];
        w.sendInputEvent(a);
      },
      { type, keyCode, modifiers },
    );
  const key = async (k) => {
    await ev('keyDown', 'Control', ['control']);
    await ev('keyDown', k, ['control']);
    await ev('keyUp', k, ['control']);
    await ev('keyUp', 'Control', []);
  };
  const tabsNow = () =>
    ui.evaluate(() =>
      [...document.querySelectorAll('.tab')].map(
        (t) =>
          (t.classList.contains('is-active') ? '*' : '') +
          t.querySelector('.tab-title').textContent,
      ),
    );
  const overlayMode = () =>
    fl.evaluate(() =>
      document.querySelector('.command-bar')
        ? 'command'
        : document.querySelector('.switcher')
          ? 'switcher'
          : 'hidden',
    );
  const blockers = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]
        .contentView.children.filter(
          (v) =>
            v.webContents.getURL().includes('view=') &&
            v.getVisible() &&
            v.getBounds().width > 0,
        )
        .map((v) => v.webContents.getURL().split('view=')[1]),
    );
  warp(o.x + 700, o.y + 400);
  // New tab button -> command bar -> open two pages
  for (const url of ['127.0.0.1:8765', '127.0.0.1:8765/two.html']) {
    await ui.click('.new-tab');
    await wait(300);
    if (url.endsWith('8765'))
      check(
        'New tab button opens command bar',
        (await overlayMode()) === 'command',
      );
    await fl.keyboard.type(url);
    await fl.keyboard.press('Enter');
    await wait(1200);
  }
  let t = await tabsNow();
  check(
    'typing in command bar opens tabs',
    t.length === 3 && t[0] === '*Page Two',
    t.join(', '),
  );
  check(
    'nothing left covering the window',
    (await blockers()).length === 0,
    JSON.stringify(await blockers()),
  );
  // Ctrl+T then Esc
  await key('T');
  await wait(300);
  check('Ctrl+T opens command bar', (await overlayMode()) === 'command');
  await fl.keyboard.press('Escape');
  await wait(300);
  check(
    'Esc closes it, no tab added',
    (await overlayMode()) === 'hidden' && (await tabsNow()).length === 3,
  );
  // click a tab
  await ui.locator('.tab').nth(1).click();
  await wait(400);
  t = await tabsNow();
  check('clicking a tab switches to it', t[1].startsWith('*'), t.join(', '));
  // Ctrl+Tab quick tap
  await key('Tab');
  await wait(400);
  t = await tabsNow();
  check('Ctrl+Tab flips to last-used tab', t[0].startsWith('*'), t.join(', '));
  // address bar in sidebar
  const addr = ui.locator('.address-input');
  await addr.click();
  await addr.fill('127.0.0.1:8765/dark.html');
  await addr.press('Enter');
  await wait(1200);
  t = await tabsNow();
  check(
    'sidebar address bar navigates',
    t.includes('*Dark page'),
    t.join(', '),
  );
  const winTitle = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getTitle(),
    );
  check(
    'the window is named after the page',
    (await winTitle()) === 'Dark page — Firn',
    await winTitle(),
  );
  await addr.click();
  await addr.fill('127.0.0.1:8765/longtitle.html');
  await addr.press('Enter');
  await wait(1200);
  check(
    '...cut short when the title is very long (the Dock menu, the taskbar)',
    /^A very long page title .{20,}… — Firn$/.test(await winTitle()) &&
      (await winTitle()).length <= 60 + ' — Firn'.length,
    await winTitle(),
  );
  await addr.click();
  await addr.fill('127.0.0.1:8765/dark.html');
  await addr.press('Enter');
  await wait(1200);
  // drag reorder: first tab to the bottom
  const firstTitle = (await tabsNow())[0].replace('*', '');
  const box = await ui.locator('.tab').first().boundingBox();
  const x = box.x + 60,
    y = box.y + 18;
  await ui.mouse.move(x, y);
  await ui.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await ui.mouse.move(x, y + i * 9);
    await wait(16);
  }
  await ui.mouse.up();
  await wait(500);
  t = await tabsNow();
  check(
    'drag to reorder (top tab to bottom)',
    t[2] === '*' + firstTitle,
    t.join(', '),
  );
  // top bar
  const pageBox = () =>
    app.evaluate(({ BrowserWindow }) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find(
        (c) =>
          c.webContents &&
          /8765|duckduckgo|google/.test(c.webContents.getURL()) &&
          c.getVisible(),
      );
      return v ? v.getBounds() : null;
    });
  const restBox = await pageBox();
  warp(o.x + 700, o.y + 2);
  // (The bar waits for the mouse to rest at the edge a moment.)
  await wait(200);
  const samples = [];
  for (let i = 0; i < 12; i++) {
    const [p, t] = await app.evaluate(({ BrowserWindow }) => {
      const kids = BrowserWindow.getAllWindows()[0].contentView.children;
      const v = kids.find(
        (c) =>
          c.webContents &&
          /8765|duckduckgo|google/.test(c.webContents.getURL()) &&
          c.getVisible(),
      );
      const t = kids.find(
        (c) => c.webContents && c.webContents.getURL().includes('view=topbar'),
      );
      return [v.getBounds(), t.getBounds()];
    });
    samples.push({ ...p, bar: t.height });
    await wait(15);
  }
  await wait(300);
  const moving = samples.filter((b) => b.y > restBox.y && b.y < 40);
  check(
    'page slides with its bottom edge staying put',
    moving.length > 0 &&
      moving.every((b) => b.y + b.height === restBox.y + restBox.height),
    moving.map((b) => b.y + ':' + b.height).join(' '),
  );
  check(
    'bar edge matches page edge while gliding',
    samples.filter((b) => b.bar > 0).every((b) => b.bar === Math.min(b.y, 40)),
    samples.map((b) => b.y + '/' + b.bar).join(' '),
  );
  const shownBox = await pageBox();
  check(
    'page settles at its new size',
    shownBox.y === 40 && shownBox.height === restBox.height - 32,
    JSON.stringify(shownBox),
  );
  const barShown = () =>
    tb.evaluate(() =>
      document.querySelector('.top-bar').classList.contains('is-shown'),
    );
  check('top bar comes down at top edge', await barShown());
  const pageY = () =>
    app.evaluate(({ BrowserWindow }) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find(
        (c) =>
          c.webContents &&
          /8765|duckduckgo|google/.test(c.webContents.getURL()) &&
          c.getVisible(),
      );
      return v ? v.getBounds().y : -1;
    });
  check(
    'page glides down below the top bar',
    (await pageY()) === 40,
    String(await pageY()),
  );
  const tbBg = await tb.evaluate(() =>
    [...document.querySelectorAll('.top-bar, .top-bar *')].every((e) => {
      const b = getComputedStyle(e).backgroundColor;
      return b === 'rgba(0, 0, 0, 0)' || e.closest('.button-row');
    }),
  );
  check('top bar has no background of its own', tbBg);
  const barBox = () =>
    app.evaluate(({ BrowserWindow, webContents }) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find(
        (c) => c.webContents && c.webContents.getURL().includes('view=topbar'),
      );
      return v.getBounds();
    });
  check(
    'buttons fully uncovered when shown',
    (await barBox()).height === 40,
    JSON.stringify(await barBox()),
  );
  check(
    'buttons never fade',
    (await tb.evaluate(
      () =>
        getComputedStyle(document.querySelector('.top-bar .button-row'))
          .opacity,
    )) === '1',
  );
  await wait(300);
  require('child_process').execSync(
    `import -window root -crop ${o.width}x140+${o.x}+${o.y}  ${process.env.SP}/tb-glass.png`,
  );
  const tbDrag = await tb.evaluate(() =>
    getComputedStyle(document.querySelector('.top-bar-drag')).getPropertyValue(
      '-webkit-app-region',
    ),
  );
  check('top bar band is a real title bar', tbDrag === 'drag');
  warp(o.x + 700, o.y + 400);
  const up = [];
  for (let i = 0; i < 40; i++) {
    const [p, t] = await app.evaluate(({ BrowserWindow }) => {
      const kids = BrowserWindow.getAllWindows()[0].contentView.children;
      const v = kids.find(
        (c) =>
          c.webContents &&
          /8765|duckduckgo|google/.test(c.webContents.getURL()) &&
          c.getVisible(),
      );
      const t = kids.find(
        (c) => c.webContents && c.webContents.getURL().includes('view=topbar'),
      );
      return [v.getBounds(), t.getBounds()];
    });
    up.push({ y: p.y, bar: t.height });
    await wait(10);
  }
  const upMoving = up.filter((b) => b.y > 8 && b.y < 40);
  check(
    'on the way up, bar is covered in step with the page',
    upMoving.length > 0 && upMoving.every((b) => b.bar === b.y),
    upMoving.map((b) => b.y + '/' + b.bar).join(' '),
  );
  await wait(400);
  check('top bar goes away after leaving', !(await barShown()));
  check(
    'page returns to the top',
    (await pageY()) === 8,
    String(await pageY()),
  );
  // collapse + peek
  const layoutSample = () =>
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
        w: b.width,
        layout: await v.webContents.executeJavaScript('innerWidth'),
      };
    });
  const slide = async () => {
    const out = [];
    for (let i = 0; i < 25; i++) {
      out.push(await layoutSample());
      await wait(8);
    }
    await wait(300);
    return out;
  };
  await key('S');
  const collapsing = await slide();
  const cMoving = collapsing.filter((s) => s.x > 8 && s.x < 260);
  check(
    'collapsing: site keeps one layout while sliding',
    cMoving.length > 0 && new Set(cMoving.map((s) => s.layout)).size === 1,
    cMoving.map((s) => s.x + ':' + s.layout).join(' '),
  );
  const cEnd = await layoutSample();
  check(
    'collapsing: site fits its new width at the end',
    cEnd.layout === cEnd.w,
    JSON.stringify(cEnd),
  );
  const pageX = () =>
    app.evaluate(({ BrowserWindow }) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find(
        (v) => !v.webContents.getURL().includes('5173') && v.getVisible(),
      );
      return v && v.getBounds().x;
    });
  check('Ctrl+S collapses sidebar', (await pageX()) === 8);
  const peekShown = () =>
    pk.evaluate(() =>
      document.querySelector('.peek').classList.contains('is-shown'),
    );
  warp(o.x + 12, o.y + 400);
  await wait(400);
  check('peek opens near left edge', await peekShown());
  warp(o.x + 700, o.y + 400);
  await wait(900);
  check('peek tucks away after leaving', !(await peekShown()));
  warp(o.x + 3, o.y + 400);
  await wait(400);
  await pk.click('.sidebar-top button[data-tip^="Keep sidebar open"]');
  await wait(80);
  const settling = await pk.evaluate(() =>
    document.querySelector('.peek').classList.contains('is-docking'),
  );
  const dockedStill = await ui.evaluate(
    () => getComputedStyle(document.querySelector('.sidebar')).transform,
  );
  check(
    "...the peeking sidebar settles into place (it doesn't slide away)",
    settling,
  );
  check(
    '...while the docked sidebar waits underneath, already in place',
    dockedStill === 'none',
    dockedStill,
  );
  await wait(420);
  check('button in peek brings sidebar back', (await pageX()) === 260);
  check(
    '...and the peeking sidebar is gone once it has settled',
    await app.evaluate(
      ({ BrowserWindow }) =>
        !BrowserWindow.getAllWindows()[0].contentView.children.some(
          (v) => v.webContents.getURL().includes('view=peek') && v.getVisible(),
        ),
    ),
  );
  const eEnd = await layoutSample();
  check(
    'expanding: site fits its new width at the end',
    eEnd.layout === eEnd.w,
    JSON.stringify(eEnd),
  );
  await key('S');
  await wait(400);
  await key('S');
  const expanding = await slide();
  const eMoving = expanding.filter((s) => s.x > 8 && s.x < 260);
  check(
    'expanding: site keeps one layout while sliding',
    eMoving.length > 0 && new Set(eMoving.map((s) => s.layout)).size === 1,
    eMoving.map((s) => s.x + ':' + s.layout).join(' '),
  );
  const eEnd2 = await layoutSample();
  check(
    'expanding (Ctrl+S): fits at the end',
    eEnd2.layout === eEnd2.w && eEnd2.x === 260,
    JSON.stringify(eEnd2),
  );
  warp(o.x + 700, o.y + 400);
  await wait(600);
  // resize
  await ui.mouse.move(256, 500);
  await ui.mouse.down();
  for (let i = 1; i <= 4; i++) {
    await ui.mouse.move(256 + i * 10, 500);
    await wait(16);
  }
  await ui.mouse.up();
  await wait(300);
  check(
    'drag gap to resize sidebar',
    (await pageX()) === 300,
    String(await pageX()),
  );
  // A resize that loses hold of the mouse (Firn left mid-drag, say) is
  // over: moving over the gap afterwards, no button held, resizes nothing.
  await ui.mouse.move(296, 500);
  await ui.mouse.down();
  for (let i = 1; i <= 2; i++) {
    await ui.mouse.move(296 + i * 5, 500);
    await wait(16);
  }
  await ui.evaluate(() =>
    document.querySelector('.sidebar-resizer').releasePointerCapture(1),
  );
  await ui.mouse.move(600, 500);
  await ui.mouse.up();
  await wait(300);
  const afterLost = await pageX();
  for (const x of [afterLost - 6, afterLost - 3, afterLost - 1]) {
    await ui.mouse.move(x, 520);
    await wait(30);
  }
  await wait(300);
  check(
    'a resize that lost the mouse is over: hovering the gap resizes nothing',
    (await pageX()) === afterLost &&
      !(await ui.evaluate(() =>
        document.querySelector('.app').classList.contains('is-resizing'),
      )),
    `${afterLost} → ${await pageX()}`,
  );
  await ui.dblclick('.sidebar-resizer');
  await wait(300);
  // final: still clickable
  check(
    'nothing left covering the window',
    (await blockers()).length === 0,
    JSON.stringify(await blockers()),
  );
  await ui.click('.new-tab');
  await wait(300);
  check('New tab still works at the end', (await overlayMode()) === 'command');
  await fl.keyboard.press('Escape');
  const errs = out.split('\n').filter((l) => l.includes('[Firn]'));
  if (errs.length) console.log('terminal messages:', errs.join(' | '));
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.error('TEST ERROR', e.message);
  process.exit(1);
});
