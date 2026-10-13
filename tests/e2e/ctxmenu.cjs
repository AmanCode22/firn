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
  // Catch menus instead of showing them.
  await app.evaluate(({ Menu }) => {
    Menu.buildFromTemplate = (t) => {
      globalThis.__menu = t;
      return { popup() {} };
    };
  });
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  await ui.click('.new-tab');
  await wait(300);
  await fl.keyboard.type('127.0.0.1:8765/ctx.html');
  await fl.keyboard.press('Enter');
  await wait(1500);
  const pg = app.windows().find((w) => w.url().includes('ctx.html'));
  const menuAt = async (sel, page = pg) => {
    await app.evaluate(() => {
      globalThis.__menu = null;
    });
    await page.click(sel, { button: 'right' });
    await wait(400);
    return app.evaluate(() =>
      (globalThis.__menu ?? []).map((i) =>
        i.type === 'separator'
          ? '—'
          : i.enabled === false
            ? '(' + i.label + ')'
            : i.label,
      ),
    );
  };
  const choose = (label) =>
    app.evaluate(
      (_, label) => globalThis.__menu.find((i) => i.label === label).click(),
      label,
    );
  const clip = () => app.evaluate(({ clipboard }) => clipboard.readText());
  const count = () =>
    ui.evaluate(async () => (await window.firn.allTabs()).length);
  const active = () =>
    ui.evaluate(
      () =>
        document.querySelector('.tab.is-active .tab-title')?.textContent ?? '',
    );
  const mode = () =>
    fl.evaluate(() =>
      document.querySelector('.lookout') ? 'lookout' : 'hidden',
    );

  let m = await menuAt('#link');
  check(
    'link: open in new tab, open in Lookout, copy link',
    m.join('|') === 'Open link in new tab|Open link in Lookout|Copy link',
    m.join(' | '),
  );
  await choose('Copy link');
  check(
    '...Copy link copies it',
    (await clip()) === 'http://localhost:8765/two.html',
    await clip(),
  );
  const n = await count();
  await choose('Open link in new tab');
  await wait(1000);
  check(
    '...Open link in new tab opens it in the background',
    (await count()) === n + 1 && (await active()) === 'Menu page',
    `${await count()} ${await active()}`,
  );
  await menuAt('#link');
  await choose('Open link in Lookout');
  await wait(1200);
  check('...Open link in Lookout previews it', (await mode()) === 'lookout');
  const lk = app
    .windows()
    .find(
      (w) =>
        w.url().includes('localhost:8765/two.html') &&
        !w.url().includes('5173'),
    );
  await app.evaluate(() => {
    globalThis.__menu = null;
  });
  await app.evaluate(({ webContents }) => {
    const w = webContents
      .getAllWebContents()
      .find((w) => w.getURL().includes('localhost:8765/two.html'));
    for (const type of ['mouseDown', 'mouseUp'])
      w.sendInputEvent({ type, x: 60, y: 60, button: 'right', clickCount: 1 });
  });
  await wait(500);
  m = await app.evaluate(() => (globalThis.__menu ?? []).map((i) => i.label));
  check(
    'right-clicking inside a Lookout preview shows the menu too',
    m.includes('Reload'),
    m.join(' | '),
  );
  await app.evaluate(({ webContents }) => {
    const w = webContents.getFocusedWebContents();
    for (const type of ['keyDown', 'keyUp'])
      w.sendInputEvent({ type, keyCode: 'Escape' });
  });
  await wait(600);
  m = await menuAt('#mail');
  check(
    'email link: just "Copy email address"',
    m.join('|') === 'Copy email address',
    m.join(' | '),
  );
  await choose('Copy email address');
  check(
    '...without "mailto:"',
    (await clip()) === 'hi@example.com',
    await clip(),
  );
  m = await menuAt('#img');
  check(
    'image: save and copy',
    m.join('|') === 'Save image|Copy image',
    m.join(' | '),
  );
  await app.evaluate(({ clipboard }) => clipboard.clear());
  await choose('Copy image');
  await wait(500);
  await wait(1000);
  const items = await app.evaluate(async ({ clipboard }) =>
    JSON.stringify(
      (await clipboard.read()).map((it) =>
        Object.keys(it).concat(it.types ?? []),
      ),
    ),
  );
  console.log('clipboard items:', items);
  check(
    '...Copy image puts the picture on the clipboard',
    /image/.test(items),
    items,
  );
  await pg.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('text'));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  m = await menuAt('#text');
  check(
    'selected text: copy and search',
    m.join('|') === 'Copy|Search for “Glacier ice moves slowly d…”',
    m.join(' | '),
  );
  await choose('Copy');
  await wait(200);
  check(
    '...Copy copies it',
    (await clip()).trim() === 'Glacier ice moves slowly downhill',
    await clip(),
  );
  const n2 = await count();
  await choose(m[1]);
  await wait(800);
  const url = await app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]
        .contentView.children.map((c) => c.webContents.getURL())
        .find((u) =>
          /(duckduckgo\.com\/\?q=|google\.com\/search\?q=|bing\.com\/search\?q=)Glacier/.test(
            u,
          ),
        ) ?? '',
  );
  check(
    '...Search opens a search for it in a new tab',
    (await count()) === n2 + 1 &&
      url.includes('Glacier%20ice%20moves%20slowly%20downhill'),
    url,
  );
  await ui.locator('.tab', { hasText: 'Menu page' }).click();
  await wait(500);
  await pg.click('#box');
  await pg.evaluate(() => document.getElementById('box').select());
  m = await menuAt('#box');
  check(
    'text box: cut, copy, paste, select all',
    m
      .filter((x) => x !== '—')
      .map((x) => x.replace(/[()]/g, ''))
      .join('|') === 'Cut|Copy|Paste|Select all',
    m.join(' | '),
  );
  await choose('Cut');
  await wait(300);
  check(
    '...Cut takes the text out',
    (await pg.evaluate(() => document.getElementById('box').value)) === '' &&
      (await clip()) === 'some words here',
    await clip(),
  );
  m = await menuAt('#box');
  await choose('Paste');
  await wait(300);
  check(
    '...Paste puts it back',
    (await pg.evaluate(() => document.getElementById('box').value)) ===
      'some words here',
  );
  await pg.evaluate(() => getSelection().removeAllRanges());
  m = await menuAt('#plain');
  check(
    'empty part of the page: back, forward, reload (and allowing ads)',
    m.join('|') === '(Back)|(Forward)|Reload|—|Allow ads on this site',
    m.join(' | '),
  );
  await pg.evaluate(() => {
    location.href = '/two.html';
  });
  await wait(1200);
  const p2 = app
    .windows()
    .find((w) => w.url().includes('127.0.0.1:8765/two.html'));
  m = await menuAt('body', p2);
  check(
    '...Back turns on after going somewhere',
    m[0] === 'Back',
    m.join(' | '),
  );
  await choose('Back');
  await wait(1200);
  check('...and goes back', (await active()) === 'Menu page', await active());
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})();
