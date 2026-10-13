// A page going fullscreen (a video's fullscreen button): the window fills
// the screen, and leaves it again when the page does, or when its tab is
// closed while fullscreen (which used to leave the window stuck there).
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
  const open = async (page) => {
    await ui.click('.new-tab');
    await wait(300);
    await fl.keyboard.type(`127.0.0.1:8765/${page}`);
    await fl.keyboard.press('Enter');
    await wait(1200);
  };
  // The window's fullscreen, and the fullscreen page's width (0 if none).
  const state = () =>
    app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const page = win.contentView.children.find(
        (v) => v.webContents && v.webContents.getURL().endsWith('/fs.html'),
      );
      return {
        window: win.isFullScreen(),
        page: page ? page.getBounds().x : null,
      };
    });
  const pageCall = (code) =>
    app.evaluate(
      ({ BrowserWindow }, code) =>
        BrowserWindow.getAllWindows()[0]
          .contentView.children.find(
            (v) => v.webContents && v.webContents.getURL().endsWith('/fs.html'),
          )
          .webContents.executeJavaScript(code, true),
      code,
    );

  await open('blue.html');
  await open('fs.html');
  const before = await state();
  await pageCall('document.documentElement.requestFullscreen()');
  await wait(1500);
  let s = await state();
  check(
    'a page goes fullscreen: the window fills the screen, the page all of it',
    s.window && s.page === 0,
    `${JSON.stringify(before)} → ${JSON.stringify(s)}`,
  );
  await pageCall('document.exitFullscreen()');
  await wait(1500);
  s = await state();
  check(
    'the page leaves fullscreen: the window does too',
    !s.window && s.page === before.page,
    JSON.stringify(s),
  );

  await pageCall('document.documentElement.requestFullscreen()');
  await wait(1500);
  s = await state();
  check('fullscreen again', s.window, JSON.stringify(s));
  await ui.evaluate(() => window.firn.runAction('close'));
  await wait(1500);
  s = await state();
  check(
    'its tab closed while fullscreen: the window leaves fullscreen',
    !s.window,
    JSON.stringify(s),
  );
  const blue = await app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find(
      (v) => v.webContents && v.webContents.getURL().endsWith('/blue.html'),
    );
    return v && v.getVisible() ? v.getBounds().x : null;
  });
  check(
    '...and the next tab sits in its usual place beside the sidebar',
    blue === before.page,
    `${blue} (expected ${before.page})`,
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
