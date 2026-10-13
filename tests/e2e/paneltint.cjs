// Panels (the command bar, Settings, History...) take a faint touch of the
// current space's color, and the command bar's picked result a soft wash;
// switching to a space of another color changes them.
const { _electron } = require('./playwright.cjs');
const path = require('path');
const { execSync } = require('child_process');
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
  execSync('rm -f /root/.config/Firn/session.json');
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  const o = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getContentBounds(),
  );
  const shot = (name) =>
    execSync(
      `import -window root -crop ${o.width}x${o.height}+${o.x}+${o.y} ${process.env.SP}/${name}.png`,
    );
  const colors = () =>
    fl.evaluate(() => {
      const panel = document.querySelector('.panel');
      const picked = document.querySelector('.result.is-selected');
      const page = getComputedStyle(document.documentElement)
        .getPropertyValue('--page')
        .trim();
      return {
        panel: panel && getComputedStyle(panel).backgroundColor,
        picked: picked && getComputedStyle(picked).backgroundColor,
        page,
      };
    });
  const setColor = (hex) =>
    ui.evaluate(async (hex) => {
      const state = await new Promise((resolve) => {
        const off = window.firn.onSpacesState((s) => {
          off();
          resolve(s);
        });
        window.firn.ready?.();
      });
      window.firn.updateSpace(state.activeSpaceId, { color: hex });
    }, hex);

  await setColor('#7f9cb0'); // Glacier
  await wait(500);
  await ui.click('.new-tab');
  await wait(400);
  await fl.keyboard.type('a');
  await wait(400);
  const glacier = await colors();
  shot('panel-glacier');
  check(
    'the command bar takes a faint touch of the space color',
    !!glacier.panel && !/251, 250, 248\)$/.test(glacier.panel),
    JSON.stringify(glacier),
  );
  check(
    '...and its picked result a soft wash of it',
    !!glacier.picked && /127 156 176|127, 156, 176/.test(glacier.picked),
    glacier.picked,
  );
  await fl.keyboard.press('Escape');
  await wait(300);

  await setColor('#b88a9e'); // Heather
  await wait(500);
  await ui.evaluate(() => window.firn.runAction('settings'));
  await wait(600);
  const heather = await colors();
  shot('panel-heather');
  check(
    'another space color tints Settings in its own color',
    !!heather.panel && heather.panel !== glacier.panel,
    `${glacier.panel} → ${heather.panel}`,
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
