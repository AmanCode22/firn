// A saved file Firn can't read (damaged) is kept aside, not overwritten:
// Firn starts fresh, with a copy of the old file beside it. A missing file
// (the first start) makes no copy.
const { _electron } = require('./playwright.cjs');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const DATA = '/root/.config/Firn';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
const copies = (name) =>
  fs.readdirSync(DATA).filter((f) => f.startsWith(`${name}.unreadable-`));
const clear = () => {
  for (const name of ['session.json', 'history.json', 'permissions.json'])
    for (const f of copies(name)) fs.rmSync(path.join(DATA, f));
};
(async () => {
  clear();
  fs.rmSync(path.join(DATA, 'permissions.json'), { force: true });
  // A session cut off mid-write, and history that isn't what Firn wrote.
  fs.writeFileSync(
    path.join(DATA, 'session.json'),
    '{"version":2,"tabs":[{"id',
  );
  fs.writeFileSync(path.join(DATA, 'history.json'), '{"entries":"nope"}');
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const session = copies('session.json');
  check(
    'a damaged session: a copy is kept beside it',
    session.length === 1 &&
      fs.readFileSync(path.join(DATA, session[0]), 'utf8') ===
        '{"version":2,"tabs":[{"id',
    session.join(', '),
  );
  const history = copies('history.json');
  check(
    'history that makes no sense: the same',
    history.length === 1 &&
      fs.readFileSync(path.join(DATA, history[0]), 'utf8') ===
        '{"entries":"nope"}',
    history.join(', '),
  );
  check(
    'no file at all (nothing decided yet): no copy',
    copies('permissions.json').length === 0,
  );
  check(
    '...and Firn starts fresh',
    (await ui.locator('.space-tabs .tab').count()) >= 1,
  );
  await app.close();
  await wait(1000);
  check(
    'the fresh session is saved over the damaged one (its copy stays)',
    JSON.parse(fs.readFileSync(path.join(DATA, 'session.json'), 'utf8'))
      .version === 2 && copies('session.json').length === 1,
  );
  clear();
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
