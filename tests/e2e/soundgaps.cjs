// A podcast going quiet between sentences is still playing: the speaker
// (and the mini player) stays for as long as the audio plays, not only
// while sound is coming out, and goes as soon as it's paused.
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
  for (const page of ['podcast.html', 'red.html']) {
    await ui.click('.new-tab');
    await wait(300);
    await fl.keyboard.type(`127.0.0.1:8765/${page}`);
    await fl.keyboard.press('Enter');
    await wait(1500);
  }
  const look = () =>
    Promise.all([
      ui.evaluate(() => {
        const row = [...document.querySelectorAll('.tab')].find((r) =>
          r.textContent.includes('Podcast'),
        );
        return {
          speaker: !!row?.querySelector('.tab-sound'),
          player: !!document.querySelector('.mini-player'),
        };
      }),
      app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .find((w) => w.getURL().endsWith('/podcast.html'))
          .isCurrentlyAudible(),
      ),
    ]).then(([shown, raw]) => ({ ...shown, raw }));

  // Watch for 8 seconds: through at least one long quiet stretch.
  const seen = [];
  for (let i = 0; i < 32; i++) {
    seen.push(await look());
    await wait(250);
  }
  const quiet = seen.filter((s) => !s.raw).length;
  check(
    '(the audio really goes quiet between sounds)',
    quiet >= 4,
    `${quiet} of ${seen.length} looks silent`,
  );
  check(
    'the speaker stays the whole time it plays',
    seen.every((s) => s.speaker),
    seen.map((s) => (s.speaker ? 'S' : '_')).join(''),
  );
  check(
    '...and so does the mini player (the tab is out of sight)',
    seen.every((s) => s.player),
    seen.map((s) => (s.player ? 'P' : '_')).join(''),
  );

  // Paused: both go at once.
  await app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .find((w) => w.getURL().endsWith('/podcast.html'))
      .executeJavaScript("document.getElementById('show').pause()"),
  );
  await wait(1000);
  const after = await look();
  check('paused, the speaker goes within a second', !after.speaker);

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
