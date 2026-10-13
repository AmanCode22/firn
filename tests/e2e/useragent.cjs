// Websites see Firn as plain Chrome: no "Firn/…" or "Electron/…" in the
// browser's name (some sites, Microsoft's among them, act differently when
// they see Electron's), in what pages read and what they're sent.
const { _electron } = require('./playwright.cjs');
const path = require('path');
const http = require('http');
const ROOT = path.resolve(__dirname, '../..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
let sent = '';
const server = http
  .createServer((req, res) => {
    sent = req.headers['user-agent'] ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<title>Agent</title>');
  })
  .listen(8767);
(async () => {
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  await ui.evaluate(() => window.firn.openUrl('127.0.0.1:8767/'));
  await wait(1500);
  const pg = app.windows().find((w) => w.url().includes(':8767/'));
  const read = await pg.evaluate(() => navigator.userAgent);
  const plain = (ua) =>
    /Chrome\/\d/.test(ua) && !/Electron|Firn/i.test(ua) && ua.length > 0;
  check('pages read a plain Chrome name', plain(read), read);
  check('...and are sent the same', plain(sent) && sent === read, sent);
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
  server.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
