// From Van Gogh at the Met in Personal → Work → Weekend, with the space
// buttons at the bottom of the sidebar, pausing on each.
import { ui } from '../lib/director.mjs';

const space = (name) => ui(`[data-testid="space"][data-space="${name}"]`);

export default {
  name: 'spaces',
  seed: 'tabs',
  // Opens on Van Gogh at the Met.
  start: { space: 'Personal', tab: 1 },
  async setup(d) {
    await d.placeCursor(420, 700);
  },
  async run(d) {
    for (const name of ['Work', 'Weekend']) {
      await d.click(space(name));
      await d.settle(2500);
      await d.pause(1000);
      await d.still();
    }
  },
};
