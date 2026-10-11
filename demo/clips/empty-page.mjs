// Each space with nothing open: Firn's empty page, whose snow and mark
// take the space's color.
import { ui } from '../lib/director.mjs';

const space = (name) => ui(`[data-testid="space"][data-space="${name}"]`);

export default {
  name: 'empty-page',
  seed: 'spaces',
  async setup(d) {
    // A first start opens one page; close it, so the space is empty.
    await d.run(
      ui('body'),
      `document.querySelectorAll('[data-testid="tab"]')
        .forEach((tab) => window.firn.closeTab(tab.dataset.item))`,
    );
    await d.waitFor(ui('.page-area.is-empty'));
    // (Closing the last tab opens the command bar, to start a new one.)
    await d.pause(500);
    await d.run(ui('body'), 'window.firn.closeOverlay()');
    await d.placeCursor(420, 640);
  },
  async run(d) {
    await d.still();
    for (const name of ['Work', 'Weekend']) {
      await d.click(space(name));
      await d.pause(1400);
    }
    await d.still();
  },
};
