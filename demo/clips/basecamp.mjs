// Clicking between the three Basecamp tiles, then adding a tab to Basecamp
// from its right-click menu.
import { ui } from '../lib/director.mjs';

export default {
  name: 'basecamp',
  seed: 'tabs',
  // Opens on twks.ch in Work.
  start: { space: 'Work', tab: 1 },
  async setup(d) {
    await d.placeCursor(420, 300);
  },
  async run(d) {
    for (let i = 0; i < 3; i++) {
      await d.click(ui('[data-testid="basecamp-tile"]', { nth: i }));
      await d.step();
    }
    await d.settle(2500);
    await d.still();
    // Then Work's first tab (Linear): right-click > Add to Basecamp.
    const tab = ui('[data-testid="tab"][data-kind="everyday"]', {
      nth: 0,
      at: [0.4, 0.5],
    });
    await d.click(tab, { button: 'right' });
    await d.chooseMenuItem('Add to Basecamp');
    await d.pause(900);
    await d.still();
  },
};
