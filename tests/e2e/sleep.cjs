// Sleeping tabs: a tab not on screen for a while (an hour; 3 seconds here,
// FIRN_SLEEP_TEST=1) is put to sleep: its page is set aside, its row rests
// quieter, and clicking it brings the page back with its history. Never
// a Basecamp tile, the tab on screen, one playing sound, or one with text
// a person typed still in it; a tab just left stays awake for the full time.
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
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    env: { ...process.env, FIRN_SLEEP_TEST: '1' },
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  const open = async (page) => {
    await ui.click('.new-tab');
    await wait(300);
    await fl.keyboard.type(`127.0.0.1:8765/${page}`);
    await fl.keyboard.press('Enter');
    await wait(1500);
  };
  // Whether a page is loaded (Firn has a web page for it).
  const awake = (page) =>
    app.evaluate(
      ({ webContents }, page) =>
        webContents
          .getAllWebContents()
          .some((w) => !w.isDestroyed() && w.getURL().endsWith('/' + page)),
      page,
    );
  const row = (title) =>
    ui.locator('.space-tabs .tab[data-kind="everyday"]', { hasText: title });
  const quiet = (title) =>
    row(title).evaluate((el) => el.classList.contains('is-unloaded'));

  // A Basecamp tile, opened once.
  await open('gray.html');
  await ui.evaluate(() => window.firn.runAction('basecamp'));
  await wait(800);
  // A tab with some history: Red, then Blue in the same tab.
  await open('red.html');
  await app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .find((w) => w.getURL().endsWith('/red.html'))
      .executeJavaScript(`location.href = '/blue.html'`),
  );
  await wait(1200);
  // Half a message in a search box, typed by a person.
  await open('topsearch.html');
  const search = app.windows().find((w) => w.url().includes('topsearch'));
  await search.click('#search');
  await search.keyboard.type('half a message');
  await open('sound.html');
  await open('green.html');
  await wait(6000);

  check(
    'a tab not on screen for a while goes to sleep: its page is set aside',
    !(await awake('blue.html')),
  );
  check('...and its row rests quieter', await quiet('Blue site'));
  check(
    'the tab on screen stays awake',
    (await awake('green.html')) && !(await quiet('Green site')),
  );
  check('a Basecamp tile, once opened, stays awake', await awake('gray.html'));
  check(
    'a tab playing sound stays awake',
    (await awake('sound.html')) && !(await quiet('Sound')),
  );
  check(
    'a tab with text a person typed stays awake',
    (await awake('topsearch.html')) && !(await quiet('Top search')),
  );

  await row('Blue site').click();
  await wait(1500);
  const back = await app.evaluate(({ webContents }) => {
    const w = webContents
      .getAllWebContents()
      .find((w) => w.getURL().endsWith('/blue.html'));
    return w ? w.navigationHistory.canGoBack() : null;
  });
  check(
    'clicking a sleeping tab brings its page back, with its history',
    back === true && !(await quiet('Blue site')),
    String(back),
  );

  // Clear the typed text, stay a while, then leave.
  await row('Top search').click();
  await wait(500);
  await search.click('#search');
  await search.keyboard.press('Control+A');
  await search.keyboard.press('Backspace');
  await wait(4000);
  await row('Green site').click();
  await wait(1500);
  check(
    'a tab just left stays awake (the time counts from when it left)',
    await awake('topsearch.html'),
  );
  await wait(4500);
  check(
    'once the typed text is gone, it can sleep too',
    !(await awake('topsearch.html')) && (await quiet('Top search')),
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
