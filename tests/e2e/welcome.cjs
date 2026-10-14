const { _electron } = require('./playwright.cjs');
const ROOT = require('path').resolve(__dirname, '../..');
const fs = require('fs');
const { execSync } = require('child_process');
const SP = process.env.SP;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
const DIR = '/root/.config/Firn';
const launch = async () => {
  console.log(
    'still running before launch:',
    execSync("pgrep -fc 'electron/dist/electro[n]' || true").toString().trim(),
  );
  execSync("pkill -f 'electron/dist/electro[n]' || true");
  await wait(1000);
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: require('path').join(
      ROOT,
      'node_modules/electron/dist/electron',
    ),
  });
  await wait(6000);
  return {
    app,
    ui: app.windows().find((w) => w.url().endsWith(':5173/')),
    fl: app.windows().find((w) => w.url().includes('view=floating')),
  };
};
// This test machine is offline: restored tabs point at the local test site.
const localize = () => {
  const f = `${DIR}/session.json`;
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const t of j.tabs) {
    t.url = 'http://127.0.0.1:8765/red.html';
    delete t.history;
  }
  fs.writeFileSync(f, JSON.stringify(j));
};
const settings = () => {
  try {
    return JSON.parse(fs.readFileSync(`${DIR}/settings.json`, 'utf8'));
  } catch {
    return {};
  }
};
(async () => {
  execSync(`rm -f ${DIR}/session.json ${DIR}/settings.json`);
  let { app, ui, fl } = await launch();
  const o = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getContentBounds(),
  );
  const shot = (name) =>
    execSync(
      `import -window root -crop ${o.width}x${o.height}+${o.x}+${o.y} ${SP}/${name}.png`,
    );
  const title = () =>
    fl.evaluate(
      () => document.querySelector('.welcome h1')?.textContent ?? null,
    );
  const next = async () => {
    await fl.click('.welcome-next');
    await wait(400);
  };

  check(
    'first run: the welcome opens by itself',
    (await title()) === 'Welcome to Firn',
    await title(),
  );
  const font = await fl.evaluate(async () => {
    await document.fonts.ready;
    return [
      getComputedStyle(document.querySelector('.welcome h1')).fontFamily,
      document.fonts.check('40px Fraunces'),
    ];
  });
  check(
    '...with the headline in Fraunces (built in)',
    font[0].startsWith('Fraunces') && font[1] === true,
    JSON.stringify(font),
  );
  // First light: the welcome covers the whole window with its scene.
  const scene = () =>
    fl.evaluate(() => {
      const w = document.querySelector('.welcome').getBoundingClientRect();
      const layers = document.querySelectorAll('.fl-snow-layer');
      const top = layers[layers.length - 1];
      return {
        full: w.width === innerWidth && w.height === innerHeight,
        snow: getComputedStyle(top.querySelector('path:nth-child(5)')).fill,
        tinted: top.classList.contains('is-tinted'),
        skip: !!document.querySelector('.welcome-skip'),
        grainUnder: !!document.querySelector('.fl-scene .fl-grain'),
      };
    });
  const hello = await scene();
  check(
    'the welcome fills the window with the First light scene',
    hello.full && hello.grainUnder && hello.skip,
    JSON.stringify(hello),
  );
  check(
    '...with glacier snow at first',
    !hello.tinted && hello.snow === 'rgb(110, 152, 178)',
    hello.snow,
  );
  shot('welcome-1');
  await ui.evaluate(() => window.firn.updateSettings({ theme: 'dark' }));
  await wait(800);
  shot('welcome-1-dark');
  await ui.evaluate(() => window.firn.updateSettings({ theme: 'system' }));
  await wait(500);
  await next();
  check(
    'step 2: where the address bar goes',
    (await title()) === 'Where should the address bar go?',
  );
  await fl.click('.welcome-look:nth-child(2)');
  await wait(700);
  check(
    'picking "At the top" switches it right away',
    settings().addressBar === 'top',
    settings().addressBar,
  );
  shot('welcome-2');
  await fl.click('.welcome-look:nth-child(1)');
  await wait(500);
  check('...and back to "In the sidebar"', settings().addressBar === 'sidebar');
  await next();
  check(
    'step 3: which search (Google ready-selected)',
    (await title()) === 'Which search do you like?' &&
      settings().searchEngine === 'google' &&
      (await fl
        .evaluate(() =>
          [...document.querySelectorAll('[data-testid="welcome-engine"]')].map(
            (b) => b.querySelector('strong').textContent,
          ),
        )
        .then((names) => names.join(',') === 'Google,DuckDuckGo,Bing')),
    settings().searchEngine,
  );
  // Suggestions as you type: asked here, neither answer picked yet.
  const suggestPicked = () =>
    fl.evaluate(
      () =>
        document.querySelector(
          '[data-testid="welcome-suggest"] [aria-checked="true"]',
        )?.textContent ?? null,
    );
  const unanswered = await suggestPicked();
  shot('welcome-search');
  await fl.click('[data-testid="welcome-suggest"] button:has-text("Yes")');
  await wait(400);
  check(
    '...and asks about suggestions as you type: "Yes" is saved',
    unanswered === null && settings().searchSuggestions === 'on',
    `${unanswered} → ${settings().searchSuggestions}`,
  );
  // (No, so later checks send nothing to a real search engine.)
  await fl.click('[data-testid="welcome-suggest"] button:has-text("No")');
  await wait(300);
  await fl.click('[data-testid="welcome-engine"]:has-text("DuckDuckGo")');
  await wait(500);
  check(
    'picking DuckDuckGo switches it right away',
    settings().searchEngine === 'duckduckgo',
  );
  await fl.click('[data-testid="welcome-engine"]:has-text("Google")');
  await wait(500);
  shot('welcome-search');
  await next();
  check(
    'step 4: your first space',
    (await title()) === 'Make your first space',
  );
  await fl.click('.welcome-name input');
  await fl.keyboard.press('Control+A');
  await fl.keyboard.press('Backspace');
  await fl.keyboard.type('Home', { delay: 120 });
  const typed = await fl.evaluate(() => [
    document.querySelector('.welcome-name input').value,
    document.activeElement?.tagName,
  ]);
  check(
    'typing the name one letter at a time stays in the box',
    typed[0] === 'Home' && typed[1] === 'INPUT',
    JSON.stringify(typed),
  );
  const glacier = await scene();
  check(
    'reaching the space step with Glacier (the default), the snow stays the same',
    glacier.snow === hello.snow,
    glacier.snow,
  );
  await fl.click('.welcome-color[aria-label="Sage"]');
  await wait(600);
  const sage = await scene();
  check(
    "from the space step, the snow takes the space's color",
    sage.tinted && sage.snow !== hello.snow,
    sage.snow,
  );
  await fl.click('.welcome-icon:nth-child(5)');
  await wait(300);
  shot('welcome-3');
  await next();
  const header = await ui.evaluate(
    () => document.querySelector('.space-header-name')?.textContent,
  );
  check('the space takes its new name and color', header === 'Home', header);
  const guide = await fl.evaluate(() => {
    const g = document.querySelector('[data-testid="welcome-guide"]');
    return {
      parts: [...(g?.querySelectorAll('li strong') ?? [])].map(
        (s) => s.textContent,
      ),
      drawing: !!g?.querySelector('svg .guide-tile'),
      tip: document.querySelector('.welcome-guide-tip')?.textContent ?? '',
    };
  });
  check(
    'step 5: how the sidebar works (a drawing: Basecamp, pinned tabs, tabs; right-click to add)',
    (await title()) === 'How your sidebar works' &&
      guide.parts.join(',') === 'Basecamp,Pinned tabs,Tabs' &&
      guide.drawing &&
      guide.tip.includes('Right-click any tab'),
    JSON.stringify(guide),
  );
  shot('welcome-guide');
  await next();
  check(
    'step 6: start your Basecamp',
    (await title()) === 'Start your Basecamp',
  );
  for (const n of ['Gmail', 'YouTube', 'Calendar'])
    await fl.click(`.welcome-site:has-text("${n}")`);
  await fl.click('.welcome-site:has-text("YouTube")'); // changed my mind
  shot('welcome-4');
  await next();
  check('step 7: tips', (await title()) === "You're all set");
  shot('welcome-5');
  await fl.click('.welcome-next');
  await wait(700);
  const finale = await fl.evaluate(() => ({
    words: document.querySelector('.welcome-in')?.textContent ?? null,
    rising: !!document.querySelector('.welcome-browser'),
    // The browser comes up in front of the words, covering them.
    over: (() => {
      const words = document.querySelector('.welcome-in');
      const browser = document.querySelector('.welcome-browser');
      return (
        !!words &&
        !!browser &&
        words.parentElement === browser.parentElement &&
        !!(words.compareDocumentPosition(browser) & 4)
      );
    })(),
    // Only transform and opacity are animated.
    props: [
      ...new Set(
        document
          .getAnimations()
          .flatMap((a) =>
            a.effect
              .getKeyframes()
              .flatMap((k) =>
                Object.keys(k).filter(
                  (p) =>
                    ![
                      'offset',
                      'computedOffset',
                      'easing',
                      'composite',
                    ].includes(p),
                ),
              ),
          ),
      ),
    ],
  }));
  check(
    '"Start browsing": "Welcome in.", then the browser rises over it',
    finale.words === 'Welcome in.' && finale.rising && finale.over,
    JSON.stringify(finale),
  );
  check(
    '...moving only with transform and opacity',
    finale.props.every((p) => p === 'transform' || p === 'opacity'),
    finale.props.join(','),
  );
  await wait(2200);
  check('...then the welcome is gone', (await title()) === null);
  const tiles = await ui.evaluate(
    () => document.querySelectorAll('.basecamp-grid > *').length,
  );
  check(
    'Basecamp starts with the chosen sites (Gmail, Calendar)',
    tiles === 2,
    String(tiles),
  );
  check("it's remembered as done", settings().onboarded === true);
  shot('welcome-after');
  // the command bar brings it back; finishing again doesn't duplicate Basecamp
  await ui.evaluate(() => window.firn.runAction('welcome'));
  await wait(600);
  check(
    '"Welcome to Firn (setup)" in the command bar brings it back',
    (await title()) === 'Welcome to Firn',
  );
  // icons: the test machine is offline, so a stand-in answers icon fetches
  await fl.keyboard.press('Escape');
  await wait(2800);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('welcome:icon');
    ipcMain.handle('welcome:icon', (_e, url) =>
      String(url).includes('claude.ai')
        ? null
        : 'data:image/svg+xml;base64,' +
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#c33"/></svg>',
          ).toString('base64'),
    );
  });
  await ui.evaluate(() => window.firn.runAction('welcome'));
  await wait(600);
  for (let i = 0; i < 5; i++) await next(); // to the Basecamp step
  const imgs = await fl.evaluate(() =>
    [...document.querySelectorAll('.welcome-site-tile')].map((t) =>
      t.querySelector('img') ? 'img' : t.textContent,
    ),
  );
  check(
    'the sites show their own icons (a letter where one cannot be fetched)',
    imgs.filter((x) => x === 'img').length === 7 && imgs[4] === 'C',
    imgs.join(','),
  );
  shot('welcome-icons');
  // With "reduce motion" on: nothing drifts, and leaving is a short fade.
  await fl.emulateMedia({ reducedMotion: 'reduce' });
  const still = await fl.evaluate(
    () => getComputedStyle(document.querySelector('.fl-flake')).animationName,
  );
  check('with reduced motion, the flakes stay still', still === 'none', still);
  await fl.keyboard.press('Escape');
  await wait(700);
  await fl.emulateMedia({ reducedMotion: 'no-preference' });
  check(
    'Esc leaves it (a plain fade with reduced motion)',
    (await title()) === null &&
      (await ui.evaluate(
        () => document.querySelectorAll('.basecamp-grid > *').length,
      )) === 2,
  );
  await app.close();
  await wait(1500);
  localize();

  // Relaunch plainly, checked over CDP (Playwright's launcher waits forever
  // on restored tabs that haven't loaded yet).
  const relaunch = async () => {
    const { spawn } = require('child_process');
    const p = spawn(
      require('path').join(ROOT, 'node_modules/electron/dist/electron'),
      ['--no-sandbox', '--remote-debugging-port=9222', '.'],
      { cwd: ROOT, stdio: 'ignore' },
    );
    await wait(10000);
    const { evalIn } = require('./cdp.cjs').cdp
      ? await require('./cdp.cjs').cdp()
      : null;
    return { p, evalIn };
  };
  let r = await relaunch();
  const fTitle = () =>
    r.evalIn(
      (u) => u.includes('view=floating'),
      "document.querySelector('.welcome h1')?.textContent ?? null",
    );
  check(
    'next time: no welcome',
    (await fTitle()) === null,
    String(await fTitle()),
  );
  const sp = await r.evalIn(
    (u) => u.endsWith(':5173/'),
    "document.querySelector('.space-header-name')?.textContent",
  );
  const bc = await r.evalIn(
    (u) => u.endsWith(':5173/'),
    "document.querySelectorAll('.basecamp-grid > *').length",
  );
  check(
    '...and the space and Basecamp are kept',
    sp === 'Home' && bc === 2,
    sp + ' ' + bc,
  );
  r.p.kill();
  await wait(2500);

  // someone who used Firn before the welcome existed: no welcome
  const s = settings();
  delete s.onboarded;
  fs.writeFileSync(`${DIR}/settings.json`, JSON.stringify(s));
  r = await relaunch();
  check(
    'an existing Firn (session, no welcome yet): not shown',
    (await fTitle()) === null && settings().onboarded === true,
    JSON.stringify(settings().onboarded),
  );
  r.p.kill();
  await wait(1000);
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
})().catch((e) => {
  console.log('TEST ERROR', e.message);
  process.exit(1);
});
