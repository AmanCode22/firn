// A website can't mark part of itself as a "drag the window here" area.
// Chrome ignores that on websites, but Electron honors it in a frameless
// window like Firn's: the Azure portal's top bar (made for its own desktop
// app) swallowed clicks on its search box, and right-clicking there opened
// Windows' window menu. Firn's own sidebar top row still moves the window.
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
  await ui.click('.new-tab');
  await wait(300);
  await fl.keyboard.type('127.0.0.1:8765/dragbar.html');
  await fl.keyboard.press('Enter');
  await wait(1500);
  const page = app.windows().find((w) => w.url().includes('dragbar.html'));
  const region = (p, sel) =>
    p.evaluate((sel) => {
      const style = getComputedStyle(document.querySelector(sel));
      return (
        style.getPropertyValue('-webkit-app-region') ||
        style.getPropertyValue('app-region') ||
        '?'
      );
    }, sel);
  const bar = await region(page, '#bar');
  check("a site's own drag area doesn't count in Firn", bar === 'no-drag', bar);
  // Still after the page changes itself.
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'late';
    div.style.cssText = '-webkit-app-region: drag; height: 20px';
    document.body.append(div);
  });
  const late = await region(page, '#late');
  check('...nor one it adds later', late === 'no-drag', late);
  const own = await region(ui, '.sidebar-top');
  check(
    "Firn's own sidebar top row still moves the window",
    own === 'drag',
    own,
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
