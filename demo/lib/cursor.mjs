// The demo cursor: the demo's clicks don't move the real pointer (and the
// recording leaves the real one out), so a pointer is drawn in a small
// window of its own: transparent, always on top, and click-through, laid
// exactly over Firn's window. It only exists while the demo runs.

// A simple macOS-style arrow (black with a white edge and a soft shadow),
// and a faint ring for a press.
const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  #cursor { position: absolute; left: 0; top: 0; width: 26px; height: 26px;
    transform-origin: 3px 2px; will-change: transform; opacity: 0;
    transition: opacity 200ms ease-out;
    filter: drop-shadow(0 1px 1.5px rgba(0,0,0,0.28)); }
  #cursor.is-shown { opacity: 1; }
  #cursor svg { display: block; transition: transform 110ms ease-out; transform-origin: 3px 2px; }
  #cursor.is-pressed svg { transform: scale(0.88); }
  .ring { position: absolute; width: 28px; height: 28px; margin: -14px 0 0 -14px;
    border-radius: 50%; border: 1.5px solid rgba(40,40,40,0.35);
    background: rgba(40,40,40,0.06); pointer-events: none;
    animation: ring 420ms ease-out forwards; }
  @keyframes ring { from { transform: scale(0.4); opacity: 1; } to { transform: scale(1); opacity: 0; } }
</style></head><body>
<div id="cursor"><svg width="26" height="26" viewBox="0 0 26 26">
  <path d="M3 2 L3 20.5 L7.6 16.4 L10.6 23.2 L13.6 21.9 L10.7 15.2 L16.8 15.2 Z"
    fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
</svg></div>
<script>
  const el = document.getElementById('cursor');
  let x = 0, y = 0;
  const place = () => (el.style.transform = 'translate(' + (x - 3) + 'px,' + (y - 2) + 'px)');
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  window.demoCursor = {
    show(nx, ny) { x = nx; y = ny; place(); el.classList.add('is-shown'); },
    glide(nx, ny, ms) {
      const fx = x, fy = y, start = performance.now();
      return new Promise((done) => {
        let ended = false;
        const end = () => {
          if (ended) return;
          ended = true; x = nx; y = ny; place(); done();
        };
        const step = (now) => {
          if (ended) return;
          const t = Math.min(1, (now - start) / ms);
          x = fx + (nx - fx) * ease(t); y = fy + (ny - fy) * ease(t); place();
          if (t < 1) requestAnimationFrame(step); else end();
        };
        requestAnimationFrame(step);
        // (Where frames don't come, e.g. a window the system thinks is
        // hidden, it still ends on time, in place.)
        setTimeout(end, ms + 150);
      });
    },
    press(down) {
      el.classList.toggle('is-pressed', down);
      if (!down) return;
      const ring = document.createElement('div');
      ring.className = 'ring';
      ring.style.left = x + 'px'; ring.style.top = y + 'px';
      document.body.appendChild(ring);
      setTimeout(() => ring.remove(), 500);
    },
  };
</script></body></html>`;

// Opens the cursor's window over `bounds` (Firn's window, in screen
// points). Returns `evaluate(fn, arg)`, which runs `fn(arg)` in it.
export async function openCursor(app, bounds) {
  await app.evaluate(
    ({ BrowserWindow }, { bounds, html }) =>
      new Promise((resolve) => {
        const win = new BrowserWindow({
          ...bounds,
          transparent: true,
          frame: false,
          hasShadow: false,
          focusable: false,
          resizable: false,
          movable: false,
          skipTaskbar: true,
          show: false,
          backgroundColor: '#00000000',
          webPreferences: { sandbox: true, contextIsolation: true },
        });
        win.setIgnoreMouseEvents(true);
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setBounds(bounds);
        globalThis.__demoCursor = win;
        win.webContents.once('did-finish-load', () => {
          win.showInactive();
          resolve();
        });
        win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      }),
    { bounds, html: HTML },
  );
  return {
    evaluate: (fn, arg) =>
      app.evaluate(
        (_electron, code) =>
          globalThis.__demoCursor.webContents.executeJavaScript(code),
        `(${fn.toString()})(${JSON.stringify(arg ?? null)})`,
      ),
  };
}
