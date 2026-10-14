// "Ask where to save each file" (Settings > Downloads): off, files go
// straight to the folder (the downloads check); on, the system's Save
// dialog asks first. The dialog can't be clicked here, so
// FIRN_SAVE_AS_TEST answers it: a folder (saved there, listed with that
// name), or "cancel" (nothing saved, nothing listed).
const { _electron } = require('./playwright.cjs');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const SETTINGS = '/root/.config/Firn/settings.json';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
const start = async (answer) => {
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    env: { ...process.env, FIRN_SAVE_AS_TEST: answer },
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  await app.evaluate(({ app }) => app.setPath('downloads', '/tmp/fdl'));
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  return { app, ui, fl };
};
const rows = (ui) =>
  ui.evaluate(() =>
    [...document.querySelectorAll('.downloads .download-name')].map(
      (n) => n.textContent,
    ),
  );
const download = async ({ app, ui, fl }) => {
  await ui.click('.new-tab');
  await wait(300);
  await fl.keyboard.type('127.0.0.1:8765/dl.html');
  await fl.keyboard.press('Enter');
  await wait(1500);
  const pg = app.windows().find((w) => w.url().includes('dl.html'));
  await pg.click('#small');
  await wait(1500);
};
(async () => {
  execSync(
    'rm -rf /tmp/fdl /tmp/fsaveas && mkdir -p /tmp/fdl /tmp/fsaveas && rm -f /root/.config/Firn/session.json /root/.config/Firn/downloads.json',
  );

  // Settings: the switch, off at first; turning it on is saved.
  const reset = () => {
    const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
    s.askWhereToSave = false;
    fs.writeFileSync(SETTINGS, JSON.stringify(s));
  };
  reset();
  let firn = await start('/tmp/fsaveas');
  await firn.ui.evaluate(() => window.firn.runAction('settings', ''));
  await wait(800);
  const shown = await firn.fl.evaluate(() => {
    const group = document.querySelector('[data-testid="ask-where-to-save"]');
    return group
      ? group.querySelector('[aria-checked="true"]')?.textContent
      : null;
  });
  check(
    'Settings > Downloads has the switch, off at first',
    shown === 'Off',
    shown,
  );
  await firn.fl.click('[data-testid="ask-where-to-save"] >> text=On');
  await wait(500);
  check(
    '...turning it on is saved',
    JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).askWhereToSave === true,
  );
  await firn.fl.keyboard.press('Escape');
  await wait(400);

  // On, and a place chosen: saved there, listed with its name.
  await download(firn);
  check(
    'on: the file goes where the person chose',
    fs.existsSync('/tmp/fsaveas/notes.txt') &&
      !fs.existsSync('/tmp/fdl/notes.txt'),
    fs.readdirSync('/tmp/fsaveas').join(','),
  );
  const listed = await rows(firn.ui);
  check(
    '...and shows in the list',
    listed[0] === 'notes.txt',
    listed.join(','),
  );
  await firn.app.close();

  // On, and the dialog cancelled: nothing saved, nothing listed. (Without
  // the tabs: Playwright's launcher hangs on restored tabs.)
  execSync('rm -f /root/.config/Firn/session.json');
  firn = await start('cancel');
  const before = (await rows(firn.ui)).length;
  await download(firn);
  const after = await rows(firn.ui);
  check(
    'cancelled: nothing saved, and nothing added to the list',
    after.length === before &&
      fs.readdirSync('/tmp/fdl').length === 0 &&
      fs.readdirSync('/tmp/fsaveas').length === 1,
    `${before} → ${after.length}`,
  );
  await firn.app.close();

  // Back as it was (the settings file carries over to other checks).
  reset();
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
