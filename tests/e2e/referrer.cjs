// A link opened in a new tab (or Lookout) tells the site where it was
// followed from, as in Chrome. Some sites need it: Reddit's image links
// lead to the post page, not the picture, without it. This test's server
// does the same: /img is the picture with a referrer, and sends you to
// /post without one.
const { _electron } = require('./playwright.cjs');
const http = require('http');
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
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const seen = [];
const server = http
  .createServer((req, res) => {
    if (req.url === '/post') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(
        '<title>Post</title><body style="padding:40px">' +
          '<a id="img" href="/img" target="_blank" style="display:block;width:200px;height:120px;background:#ccd">image</a></body>',
      );
    }
    if (req.url === '/img') {
      seen.push(req.headers.referer ?? '');
      if (!req.headers.referer) {
        res.writeHead(302, { Location: '/post' });
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(PNG);
    }
    res.writeHead(404);
    res.end();
  })
  .listen(8770);
(async () => {
  execSync('rm -f /root/.config/Firn/session.json');
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  await ui.evaluate(() => window.firn.openUrl('127.0.0.1:8770/post'));
  await wait(1500);
  const urls = () =>
    app.evaluate(({ webContents }) =>
      webContents.getAllWebContents().map((w) => w.getURL()),
    );
  const pg = app.windows().find((w) => w.url().endsWith(':8770/post'));

  // A link that opens in a new tab.
  await pg.click('#img');
  await wait(1500);
  let u = await urls();
  check(
    'a link opening a new tab sends where it came from: the picture opens, not the post again',
    u.some((x) => x.endsWith(':8770/img')) &&
      seen[0] === 'http://127.0.0.1:8770/post',
    `${seen[0]} / ${u.filter((x) => x.includes(':8770')).join(', ')}`,
  );

  // Shift+click: Lookout.
  await pg.click('#img', { modifiers: ['Shift'] });
  await wait(1500);
  check(
    'Shift+click (Lookout) does too',
    seen.length >= 2 && seen[1] === 'http://127.0.0.1:8770/post',
    seen.join(' | '),
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
  server.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
