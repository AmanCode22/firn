// The calm, human pacing every clip shares, and the actions clips use:
// glide the demo cursor to something and click it, type, scroll, drag,
// pick from a right-click menu, and take stills.
//
// Firn's window is made of layers, each a page of its own: the sidebar
// (the window itself), the web page on screen, the floating panels
// (command bar, Lookout's buttons, the welcome), and the top bar. A
// target names its layer and a CSS selector in it:
//   ui('[data-testid="new-tab"]')            the sidebar
//   floating('[data-testid="command-input"]') the floating panels
//   web('a.some-link', { url: '/wiki/Firn' }) the web page on screen
// Everything goes through Firn's main process: Electron's own
// executeJavaScript (to find things) and sendInputEvent (to point, click,
// type, and scroll) for each layer.

export const PACE = {
  lead: 1200, // still, before the first action and after the last
  step: 700, // between steps
  glide: 600, // the cursor's move to a target
  press: 110, // between pressing and releasing
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// Targets: a layer and a selector, optionally the nth match or the one
// containing some text.
export const ui = (selector, options = {}) => ({
  layer: 'ui',
  selector,
  ...options,
});
export const floating = (selector, options = {}) => ({
  layer: 'floating',
  selector,
  ...options,
});
// `url`: part of the page's address; `notUrl`: a part it doesn't have;
// `top`: the page in front (Lookout's preview) rather than the biggest.
// The selector ':page' means the page's whole area.
export const web = (selector, options = {}) => ({
  layer: 'web',
  selector,
  ...options,
});

// The same "random" numbers on every run (so typing has the same rhythm).
export function seededRandom(text) {
  let seed = 0;
  for (const c of text) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Installs the demo's helpers in Firn's main process (they only live
// there while the demo runs; Firn's own code has none of this).
export async function installDriver(app) {
  await app.evaluate(({ BrowserWindow, webContents }) => {
    const DEV = 'http://localhost:5173/';
    // Firn's window: its first window (not the demo cursor's), whatever
    // it has loaded.
    const mainWindow = () =>
      BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed() && w !== globalThis.__demoCursor)
        .sort((a, b) => a.id - b.id)[0];
    const layers = () => {
      const win = mainWindow();
      if (!win) return [];
      const [width, height] = win.getContentSize();
      const all = [
        {
          id: win.webContents.id,
          url: DEV,
          x: 0,
          y: 0,
          width,
          height,
          shown: true,
          loading: false,
        },
      ];
      for (const view of win.contentView.children) {
        if (!view.webContents || view.webContents.isDestroyed()) continue;
        const b = view.getBounds();
        all.push({
          id: view.webContents.id,
          url: view.webContents.getURL(),
          ...b,
          shown: view.getVisible() && b.width > 0 && b.height > 0,
          loading: view.webContents.isLoading(),
        });
      }
      return all;
    };
    const layerFor = (target) => {
      const all = layers();
      if (target.layer === 'ui') return all[0];
      if (target.layer === 'floating')
        return all.find((l) => l.url.includes('view=floating'));
      const pages = all.filter(
        (l) =>
          l.shown &&
          !l.url.startsWith(DEV) &&
          (!target.url || l.url.includes(target.url)) &&
          (!target.notUrl || !l.url.includes(target.notUrl)),
      );
      // `top`: the page in front (e.g. Lookout's preview); otherwise the
      // biggest.
      if (target.top) return pages.at(-1);
      return pages.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    };
    // Runs code in a layer; null if it doesn't answer in time (a page that
    // hasn't been created yet never does).
    const run = (id, code, ms = 5000) => {
      const wc = webContents.fromId(id);
      if (!wc || wc.isDestroyed()) return Promise.resolve(null);
      return Promise.race([
        wc.executeJavaScript(code).catch(() => null),
        new Promise((resolve) => setTimeout(() => resolve(null), ms)),
      ]);
    };
    globalThis.__demoDrive = {
      mainWindow,
      layers,
      layerFor,
      // Where a target is: in its layer, and in the window. Null if it's
      // not there (or not shown).
      async spot(target, share) {
        const layer = layerFor(target);
        if (!layer) return null;
        // ':page': the page's area itself, whatever's in it (some pages,
        // all canvas, have no element with a size).
        if (target.selector === ':page') {
          const local = {
            x: layer.width * share[0],
            y: layer.height * share[1],
          };
          return {
            id: layer.id,
            local,
            window: { x: local.x + layer.x, y: local.y + layer.y },
            offset: { x: layer.x, y: layer.y },
          };
        }
        const code = `(() => {
          // Only things that are shown (and, with inView, on screen).
          const shown = (el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 &&
              (!${!!target.inView} || (r.top >= 0 && r.bottom <= innerHeight &&
                r.left >= 0 && r.right <= innerWidth));
          };
          const all = [...document.querySelectorAll(${JSON.stringify(target.selector)})]
            .filter((el) => ${JSON.stringify(target.text ?? '')} === '' ||
              el.textContent.includes(${JSON.stringify(target.text ?? '')}))
            .filter(shown);
          const el = all[${target.nth ?? 0}];
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        })()`;
        const box = await run(layer.id, code);
        if (!box) return null;
        const local = {
          x: box.x + box.width * share[0],
          y: box.y + box.height * share[1],
        };
        return {
          id: layer.id,
          local,
          window: { x: local.x + layer.x, y: local.y + layer.y },
          offset: { x: layer.x, y: layer.y },
        };
      },
      input(id, event) {
        const wc = webContents.fromId(id);
        if (wc && !wc.isDestroyed()) wc.sendInputEvent(event);
      },
      js(id, code, ms) {
        return run(id, code, ms);
      },
      // What a target's selector finds in its layer, for working out why
      // it wasn't found.
      async probe(target) {
        const layer = layerFor(target);
        if (!layer) return 'no such layer';
        const answer = await run(
          layer.id,
          `(() => {
            const all = [...document.querySelectorAll(${JSON.stringify(target.selector)})];
            const box = (el) => { const r = el.getBoundingClientRect();
              return Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); };
            const links = [...document.querySelectorAll('#mw-content-text a')].slice(0, 5)
              .map((a) => a.getAttribute('href') + ' @' + box(a));
            return JSON.stringify({ page: location.href, ready: document.readyState,
              view: innerWidth + 'x' + innerHeight + ' scrolled ' + scrollY,
              matches: all.length, first: all.slice(0, 3).map(box),
              content: !!document.querySelector('#mw-content-text'), links });
          })()`,
        );
        return answer ?? 'the page didn’t answer';
      },
      offsetOf(id) {
        const layer = layers().find((l) => l.id === id);
        return layer ? { x: layer.x, y: layer.y } : { x: 0, y: 0 };
      },
    };
  });
}

export function createDirector({ app, cursor, random, takeStill }) {
  const drive = (method, ...args) =>
    app.evaluate(
      (_electron, [method, args]) => globalThis.__demoDrive[method](...args),
      [method, args],
    );
  const toCursor = (fn, args) => cursor.evaluate(fn, args);

  let at = { x: 0, y: 0 }; // the demo cursor, in window coordinates
  let hovered = null; // the layer that last got a pointer move

  const spotOf = async (target, timeout = 15_000) => {
    const share = target.at ?? [0.5, 0.5];
    const deadline = Date.now() + timeout;
    for (;;) {
      const spot = await drive('spot', target, share);
      if (spot) return spot;
      if (Date.now() > deadline) {
        // Which page was looked in, for working out why.
        const pages = await drive('layers').catch(() => []);
        const where = pages
          .filter((l) => l.shown)
          .map((l) => l.url)
          .join(', ');
        const found = await drive('probe', target).catch((e) => String(e));
        throw new Error(
          `Couldn’t find ${target.selector} (${target.layer}; showing: ${where || 'nothing'}; in it: ${found}).`,
        );
      }
      await wait(150);
    }
  };

  const mouse = (id, type, x, y, extra = {}) =>
    drive('input', id, { type, x: Math.round(x), y: Math.round(y), ...extra });

  // Glides the cursor to a window spot, moving the layer's own pointer
  // along with it (so things light up on hover as it passes).
  const glideTo = async (spot, ms = PACE.glide) => {
    if (hovered !== null && hovered !== spot.id)
      await drive('input', hovered, { type: 'mouseLeave', x: 0, y: 0 });
    hovered = spot.id;
    const target = spot.window;
    const from = { ...at };
    const distance = Math.hypot(target.x - from.x, target.y - from.y);
    const time = distance < 4 ? 0 : Math.max(250, Math.min(ms, 250 + distance));
    const glide = time
      ? toCursor(
          ([x, y, t]) => window.demoCursor.glide(x, y, t),
          [target.x, target.y, time],
        )
      : Promise.resolve();
    const start = Date.now();
    for (;;) {
      const t = time ? Math.min(1, (Date.now() - start) / time) : 1;
      const x = from.x + (target.x - from.x) * ease(t);
      const y = from.y + (target.y - from.y) * ease(t);
      await mouse(spot.id, 'mouseMove', x - spot.offset.x, y - spot.offset.y);
      if (t >= 1) break;
      await wait(32);
    }
    await glide;
    at = { ...target };
  };

  const press = (down) =>
    toCursor((down) => window.demoCursor.press(down), down);

  const keyTarget = async (target) => (await drive('layerFor', target)).id;

  const director = {
    random,
    pause: (ms) => wait(ms),
    step: () => wait(PACE.step),

    // Puts the cursor somewhere without a glide (before recording).
    async placeCursor(x, y) {
      at = { x, y };
      await toCursor(([x, y]) => window.demoCursor.show(x, y), [x, y]);
    },

    // Waits for a target to be there.
    async waitFor(target, timeout) {
      await spotOf(target, timeout);
    },

    // Runs `code` (a function's source, as text) in a target's layer.
    async run(target, code) {
      return drive('js', await keyTarget(target), code);
    },

    async hover(target) {
      await glideTo(await spotOf(target));
    },

    // `button`: 'left' or 'right'; `shift`: Shift+click.
    async click(target, { button = 'left', shift = false } = {}) {
      const spot = await spotOf(target);
      await glideTo(spot);
      await wait(120);
      const extra = {
        button,
        clickCount: 1,
        modifiers: shift ? ['shift'] : [],
      };
      await press(true);
      await mouse(spot.id, 'mouseDown', spot.local.x, spot.local.y, extra);
      await wait(PACE.press);
      await mouse(spot.id, 'mouseUp', spot.local.x, spot.local.y, extra);
      await press(false);
    },

    // Picks an item of the right-click menu that's open. The system draws
    // the menu, so the cursor glides to where the item is: below where the
    // menu opened, by its rows (Firn says how many come before it).
    async chooseMenuItem(label) {
      await wait(PACE.step);
      const position = await app.evaluate(
        (_electron, label) => globalThis.__firnDemo.menuItemPosition(label),
        label,
      );
      if (!position) throw new Error(`The menu has no “${label}”.`);
      const mac = process.platform === 'darwin';
      const rowHeight = mac ? 22 : 26;
      const lineHeight = mac ? 10 : 9;
      const target = {
        x: at.x + 50,
        y:
          at.y +
          (mac ? 5 : 4) +
          position.row * rowHeight +
          position.separators * lineHeight +
          rowHeight / 2,
      };
      await toCursor(
        ([x, y, t]) => window.demoCursor.glide(x, y, t),
        [target.x, target.y, 400],
      );
      at = target;
      await wait(180);
      await press(true);
      await wait(PACE.press);
      await press(false);
      await app.evaluate(
        (_electron, label) => globalThis.__firnDemo.chooseMenuItem(label),
        label,
      );
    },

    // Types into the layer `target` names (into what has the keyboard
    // there), at a natural speed, a little uneven.
    async type(target, text) {
      const id = await keyTarget(target);
      for (const char of text) {
        await drive('input', id, { type: 'char', keyCode: char });
        await wait(70 + random() * 80 + (char === ' ' ? 60 : 0));
      }
    },

    // A key such as 'Enter' or 'Escape'.
    async press(target, key) {
      const id = await keyTarget(target);
      await drive('input', id, { type: 'keyDown', keyCode: key });
      if (key === 'Enter')
        await drive('input', id, { type: 'char', keyCode: '\r' });
      await wait(60);
      await drive('input', id, { type: 'keyUp', keyCode: key });
    },

    // Short, smooth scrolls over a target's middle: `dy` pixels in all, in
    // small steps.
    async scroll(target, dy) {
      const spot = await spotOf(target);
      await glideTo(spot);
      await wait(150);
      const steps = Math.max(1, Math.round(Math.abs(dy) / 12));
      for (let i = 0; i < steps; i++) {
        await mouse(spot.id, 'mouseWheel', spot.local.x, spot.local.y, {
          deltaX: 0,
          deltaY: -dy / steps,
          canScroll: true,
        });
        await wait(24);
      }
      await wait(350);
    },

    // Presses on a target, moves it by (dx, dy) slowly, and lets go.
    // Drags a target to a spot in the window (`x`, `y`, in points).
    async dragTo(target, x, y, ms = 1400) {
      const spot = await spotOf(target);
      return this.drag(target, x - spot.window.x, y - spot.window.y, ms);
    },

    async drag(target, dx, dy, ms = 900) {
      const spot = await spotOf(target);
      await glideTo(spot);
      await wait(150);
      const extra = { button: 'left', clickCount: 1 };
      await press(true);
      await mouse(spot.id, 'mouseDown', spot.local.x, spot.local.y, extra);
      const from = { ...at };
      const glide = toCursor(
        ([x, y, t]) => window.demoCursor.glide(x, y, t),
        [from.x + dx, from.y + dy, ms],
      );
      const start = Date.now();
      for (;;) {
        const t = Math.min(1, (Date.now() - start) / ms);
        await mouse(
          spot.id,
          'mouseMove',
          spot.local.x + dx * ease(t),
          spot.local.y + dy * ease(t),
          // (The button is held all the way.)
          { button: 'left', modifiers: ['leftButtonDown'] },
        );
        if (t >= 1) break;
        await wait(16);
      }
      await glide;
      at = { x: from.x + dx, y: from.y + dy };
      await wait(120);
      await mouse(
        spot.id,
        'mouseUp',
        spot.local.x + dx,
        spot.local.y + dy,
        extra,
      );
      await press(false);
    },

    // Waits until every page on screen has loaded and its fonts are in,
    // then a moment more for things to settle. In a clip, give it a short
    // `timeout` (e.g. 2500), so a slow website can't stretch the clip.
    async settle(timeout = 30_000) {
      const deadline = Date.now() + timeout;
      for (;;) {
        const busy = (await drive('layers')).some((l) => l.shown && l.loading);
        if (!busy || Date.now() > deadline) break;
        await wait(200);
      }
      const pages = (await drive('layers')).filter(
        (l) => l.shown && !l.url.startsWith('http://localhost:5173/'),
      );
      for (const layer of pages)
        await drive(
          'js',
          layer.id,
          `Promise.race([document.fonts.ready.then(() => true),
            new Promise((r) => setTimeout(r, 3000))])`,
        ).catch(() => {});
      await wait(250);
    },

    // A still of the window, now.
    still: () => takeStill(),
  };
  // DEMO_DEBUG=1: how long each step takes.
  if (process.env.DEMO_DEBUG)
    for (const [name, action] of Object.entries(director))
      if (typeof action === 'function')
        director[name] = async (...args) => {
          const start = Date.now();
          try {
            return await action(...args);
          } finally {
            const what =
              args[0]?.selector ?? (typeof args[0] === 'string' ? args[0] : '');
            console.log(`[demo]     ${name} ${what} ${Date.now() - start}ms`);
          }
        };
  return director;
}
