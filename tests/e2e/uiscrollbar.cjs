// Scrollbars in Firn's own UI: a long tab list scrolls with the same soft,
// thin scrollbar as web pages (no arrows, no gray strip), not the system's.
const { _electron } = require('./playwright.cjs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const SP = process.env.SP;
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
  const pages = ['red', 'blue', 'green', 'gray', 'mix', 'two', 'styled'];
  for (let i = 0; i < 24; i++) {
    await ui.click('.new-tab');
    await wait(200);
    await fl.keyboard.type(
      `127.0.0.1:8765/${pages[i % pages.length]}.html?${i}`,
    );
    await fl.keyboard.press('Enter');
    await wait(250);
  }
  await wait(1500);
  const bar = await ui.evaluate(() => {
    const list = document.querySelector('.space-tabs');
    const thumb = getComputedStyle(list, '::-webkit-scrollbar-thumb');
    return {
      scrolls: list.scrollHeight > list.clientHeight,
      width: list.offsetWidth - list.clientWidth,
      thumb: thumb.backgroundColor,
      button: getComputedStyle(list, '::-webkit-scrollbar-button').display,
    };
  });
  check(
    'a long tab list scrolls with the soft, thin scrollbar, no arrows',
    bar.scrolls && bar.width === 12 && bar.button === 'none',
    JSON.stringify(bar),
  );
  const o = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getContentBounds(),
  );
  execSync(
    `import -window root -crop 280x${o.height}+${o.x}+${o.y} ${SP}/uiscrollbar.png`,
  );
  // Settings, in a window short enough that it scrolls: the same.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 560),
  );
  await wait(600);
  await ui.evaluate(() => window.firn.runAction('settings', ''));
  await wait(800);
  const sheet = await fl.evaluate(() => {
    const body = document.querySelector('.sheet-body');
    return {
      scrolls: body.scrollHeight > body.clientHeight,
      width: body.offsetWidth - body.clientWidth,
      button: getComputedStyle(body, '::-webkit-scrollbar-button').display,
    };
  });
  check(
    'Settings scrolls with the same scrollbar',
    sheet.scrolls && sheet.width === 12 && sheet.button === 'none',
    JSON.stringify(sheet),
  );
  const o2 = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getContentBounds(),
  );
  execSync(
    `import -window root -crop ${o2.width}x${o2.height}+${o2.x}+${o2.y} ${SP}/uiscrollbar-settings.png`,
  );
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
