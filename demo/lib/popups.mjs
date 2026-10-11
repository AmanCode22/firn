// Finds anything big fixed over the pages on screen: a pop-up, banner, or
// prompt that got past demo mode's hiding (src/demo.ts). Resolves to a
// line per page: its address, and what's over it.
export async function findPopups(app) {
  return app
    .evaluate(async () => {
      const drive = globalThis.__demoDrive;
      const out = [];
      for (const layer of drive.layers()) {
        if (!layer.shown || layer.url.startsWith('http://localhost:5173/'))
          continue;
        const big = await drive.js(
          layer.id,
          `(() => {
            const vw = innerWidth, vh = innerHeight;
            return [...document.querySelectorAll('body *')].filter((el) => {
              const s = getComputedStyle(el);
              if (s.position !== 'fixed' || s.display === 'none' ||
                  s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
              const b = el.getBoundingClientRect();
              const w = Math.max(0, Math.min(b.right, vw) - Math.max(b.left, 0));
              const h = Math.max(0, Math.min(b.bottom, vh) - Math.max(b.top, 0));
              // (A bar along the top is the site's own header.)
              return b.top > 4 && w * h > vw * vh * 0.08;
            }).slice(0, 3).map((el) => el.tagName.toLowerCase() +
              (el.id ? '#' + el.id : '') +
              (typeof el.className === 'string' && el.className
                ? '.' + el.className.trim().split(/\\s+/)[0] : ''));
          })()`,
          3000,
        );
        if (big?.length) out.push(`${layer.url} (${big.join(', ')})`);
      }
      return out;
    })
    .catch(() => []);
}
