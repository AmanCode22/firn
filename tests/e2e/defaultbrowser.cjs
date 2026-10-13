// Firn as the default browser: a link handed to Firn by another app opens
// as a new tab (when Firn starts with it, and when Firn is already running,
// as Windows does). The Settings row only shows where this copy can be the
// default (installed on Windows, or in a Mac's Applications folder), so not
// on this Linux copy run from the source code. The welcome's optional
// "Open links in Firn?" step is checked by pretending it can be.
const { _electron } = require('./playwright.cjs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron');
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
  fs.writeFileSync(
    '/root/.config/Firn/settings.json',
    JSON.stringify({
      onboarded: true,
      lastVersion: require('../../package.json').version,
    }),
  );
  // Started by another app with a link.
  const app = await _electron.launch({
    args: ['--no-sandbox', '.', 'http://127.0.0.1:8765/red.html'],
    cwd: ROOT,
    executablePath: ELECTRON,
  });
  await wait(6500);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const titles = () =>
    ui.evaluate(() =>
      [...document.querySelectorAll('.space-tabs .tab')].map((t) => ({
        title: t.querySelector('.tab-title')?.textContent,
        active: t.classList.contains('is-active'),
      })),
    );
  let t = await titles();
  check(
    'started with a link: it opens, on screen (and no start page beside it)',
    t.length === 1 && t[0].title === 'Red site' && t[0].active,
    JSON.stringify(t),
  );

  // Already running: a second start with a link hands it over and quits.
  const second = spawn(
    ELECTRON,
    ['--no-sandbox', '.', 'http://127.0.0.1:8765/green.html'],
    { cwd: ROOT, stdio: 'ignore' },
  );
  const exited = await Promise.race([
    new Promise((r) => second.on('exit', () => r(true))),
    wait(8000).then(() => false),
  ]);
  await wait(1500);
  t = await titles();
  check(
    'already running: the link opens as a new tab in the same window',
    t.length === 2 &&
      t.some((x) => x.title === 'Green site' && x.active) &&
      (await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      )) === 1,
    JSON.stringify(t),
  );
  check('...and the second Firn quits right away', exited);
  if (!exited) second.kill();

  // Not a web address: ignored.
  const third = spawn(
    ELECTRON,
    ['--no-sandbox', '.', 'javascript:alert(1)', '/etc/passwd'],
    { cwd: ROOT, stdio: 'ignore' },
  );
  await new Promise((r) => third.on('exit', r));
  await wait(1000);
  check(
    "anything that isn't a web address or a web page file is ignored",
    (await titles()).length === 2,
  );

  // As Windows starts Firn for a link: `--` before it, so nothing after it
  // is a setting for Chromium (here one that would make a separate Firn
  // with its own data, which wouldn't hand the link over).
  const fifth = spawn(
    ELECTRON,
    [
      '--no-sandbox',
      '.',
      '--',
      '--user-data-dir=/tmp/firn-not-this',
      'http://127.0.0.1:8765/blue.html',
    ],
    { cwd: ROOT, stdio: 'ignore' },
  );
  const fifthExited = await Promise.race([
    new Promise((r) => fifth.on('exit', () => r(true))),
    wait(8000).then(() => false),
  ]);
  if (!fifthExited) fifth.kill();
  await wait(1500);
  t = await titles();
  check(
    'a link after "--" opens here, and a setting after it is ignored',
    fifthExited &&
      t.length === 3 &&
      t.some((x) => x.title === 'Blue site' && x.active) &&
      !require('fs').existsSync('/tmp/firn-not-this'),
    JSON.stringify(t),
  );

  // A PDF (and the like) handed over from another app opens in Firn; a
  // plain text file doesn't.
  const site = require('path').join(__dirname, 'site');
  const fourth = spawn(
    ELECTRON,
    [
      '--no-sandbox',
      '.',
      require('path').join(site, 'doc.pdf'),
      require('path').join(site, 'notes.txt'),
    ],
    { cwd: ROOT, stdio: 'ignore' },
  );
  await new Promise((r) => fourth.on('exit', r));
  await wait(2000);
  const urls = await app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().map((w) => w.getURL()),
  );
  check(
    'a PDF from another app opens in a new tab; a text file is ignored',
    urls.some((u) => u.startsWith('file://') && u.endsWith('/doc.pdf')) &&
      !urls.some((u) => u.endsWith('/notes.txt')) &&
      (await titles()).length === 4,
    urls.filter((u) => u.startsWith('file://')).join(', '),
  );

  // Settings: no "Default browser" here (a copy that can't be the default).
  await ui.evaluate(() => window.firn.runAction('settings'));
  await wait(600);
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  const groups = await fl.evaluate(() =>
    [...document.querySelectorAll('.settings-group h3')].map(
      (h) => h.textContent,
    ),
  );
  check(
    'Settings leaves out "Default browser" where this copy can\'t be it',
    groups.length > 0 && !groups.includes('Default browser'),
    groups.join(', '),
  );
  await app.close();
  await wait(1000);

  // The welcome's optional step, where Firn can be the default and isn't
  // yet (pretended here, since this copy can't be).
  execSync('rm -f /root/.config/Firn/session.json');
  fs.writeFileSync('/root/.config/Firn/settings.json', '{}');
  const fresh = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: ELECTRON,
    env: { ...process.env, FIRN_DEFAULT_BROWSER_TEST: 'no' },
  });
  await wait(6500);
  const wf = fresh.windows().find((w) => w.url().includes('view=floating'));
  const heading = () =>
    wf.evaluate(() => document.querySelector('.welcome h1')?.textContent);
  const seen = [];
  for (let i = 0; i < 10 && (await heading()) !== 'Open links in Firn?'; i++) {
    seen.push(await heading());
    await wf.click('.welcome-next');
    await wait(500);
  }
  const dots = await wf.evaluate(
    () => document.querySelectorAll('.welcome-dots span').length,
  );
  check(
    'welcome: "Open links in Firn?" comes after Basecamp',
    (await heading()) === 'Open links in Firn?' &&
      seen.at(-1) === 'Start your Basecamp' &&
      dots === 8,
    `${seen.join(' > ')}; ${dots} dots`,
  );
  const shot = (name) =>
    execSync(
      `import -window root -crop 1400x900+0+0 ${process.env.SP}/${name}.png`,
    );
  shot('welcome-default');
  await wf.click('.welcome-default-button');
  await wait(2200);
  const done = await wf.evaluate(
    () => document.querySelector('.welcome-default-done')?.textContent ?? null,
  );
  shot('welcome-default-done');
  check(
    '"Make Firn default" asks, then says Firn is the default',
    done === 'Firn is your default browser',
    done,
  );
  await wf.click('.welcome-next');
  await wait(500);
  check(
    '...and Continue goes on to the tips',
    (await heading()) === "You're all set",
    await heading(),
  );
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await fresh.close();
})().catch((e) => {
  console.log('TEST ERROR', e.message);
  process.exit(1);
});
