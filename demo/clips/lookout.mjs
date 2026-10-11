// On firnbrowser.com: Shift+click a link to preview it in Lookout, scroll
// it a little, and close it.
import { floating, web } from '../lib/director.mjs';

const HOME = 'firnbrowser.com';

export default {
  name: 'lookout',
  seed: 'tabs',
  async setup(d) {
    await d.placeCursor(900, 700);
  },
  async run(d) {
    // The release notes link if it's on screen; otherwise the first link
    // on screen to another page (not a download, not the page itself).
    const notes = web('a[href*="release-notes"]', { url: HOME, inView: true });
    const page = web('body', { url: HOME });
    const hasNotes = await d.run(
      page,
      `[...document.querySelectorAll('a[href*="release-notes"]')].some((a) => { const r = a.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight; })`,
    );
    const link = hasNotes
      ? notes
      : web(
          'a[href]:not([href^="#"]):not([href$=".exe"]):not([href$=".zip"]):not([href$=".dmg"]):not([href="/"])',
          { url: HOME, inView: true },
        );
    await d.click(link, { shift: true });
    // The preview: the page in front.
    const preview = web(':page', { top: true });
    await d.waitFor(floating('[data-testid="lookout-close"]'));
    await d.settle(2500);
    await d.step();
    await d.scroll(preview, 320);
    await d.step();
    await d.still();
    await d.scroll(preview, 200);
    await d.step();
    await d.click(floating('[data-testid="lookout-close"]'));
    await d.pause(400);
  },
};
