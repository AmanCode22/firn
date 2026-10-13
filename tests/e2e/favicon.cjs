// Favicon downloads stay small and quick: a normal icon comes back, while
// one that's too big (said up front, or only found out while reading), or
// a server that never finishes, gives nothing, and Firn doesn't wait long.
const { _electron } = require('./playwright.cjs');
const http = require('http');
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
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#6e98b2"/></svg>';
(async () => {
  let endlessClosed = false;
  const server = http
    .createServer((req, res) => {
      if (req.url === '/small.svg') {
        res.writeHead(200, { 'content-type': 'image/svg+xml' });
        return res.end(SVG);
      }
      if (req.url === '/big.png') {
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(Buffer.alloc(2 * 1024 * 1024));
      }
      if (req.url === '/endless.png') {
        // No size said, and it never ends.
        res.writeHead(200, { 'content-type': 'image/png' });
        const chunk = Buffer.alloc(64 * 1024);
        const timer = setInterval(() => res.write(chunk), 5);
        // Firn hanging up.
        req.on('close', () => {
          endlessClosed = true;
          clearInterval(timer);
        });
        return;
      }
      if (req.url === '/silent.png') return; // never answers
      res.writeHead(404);
      res.end();
    })
    .listen(8766);

  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const icon = async (name) => {
    const start = Date.now();
    const data = await ui.evaluate(
      (url) => window.firn.iconData(url),
      `http://127.0.0.1:8766/${name}`,
    );
    return { data, ms: Date.now() - start };
  };

  const small = await icon('small.svg');
  check(
    'a normal icon comes back',
    typeof small.data === 'string' && small.data.startsWith('data:image/svg'),
    String(small.data).slice(0, 30),
  );
  const big = await icon('big.png');
  check('one too big (said up front): nothing', big.data === null);
  const endless = await icon('endless.png');
  await wait(500);
  check(
    'one that never ends: nothing, and Firn hangs up on it',
    endless.data === null && endlessClosed && endless.ms < 5000,
    `${endless.ms} ms`,
  );
  const silent = await icon('silent.png');
  check(
    'a server that never answers: nothing, after a few seconds',
    silent.data === null && silent.ms < 10000,
    `${silent.ms} ms`,
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
  server.close();
  process.exit(0);
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
