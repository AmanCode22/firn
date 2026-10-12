// A layer Firn has put away (the peeking sidebar, the floating layer, the
// top bar) draws nothing, so its animations never reach their last frame
// and keep it busy forever: it once kept an idle Firn at about 8% of a
// processor core. While hidden, one-time animations jump to their end
// (nothing replays when it's shown again) and endless ones (the loading
// line, spinners) pause until it's back. The sidebar of the window itself
// is never put away.
let hidden = false;

// Whether a layer is on screen to animate (the tab lists' glides ask).
export const layerShown = () => !hidden;

export function quietWhenHidden(view: string) {
  hidden = view !== 'main';
  const paused = new Set<Animation>();
  const settle = () => {
    for (const animation of document.getAnimations()) {
      if (animation.playState !== 'running') continue;
      if (animation.effect?.getTiming().iterations === Infinity) {
        animation.pause();
        paused.add(animation);
      } else {
        try {
          animation.finish();
        } catch {
          animation.cancel();
        }
      }
    }
  };
  // Animations that start while hidden (a class or an element added, as
  // the archive box's pulse does) settle a moment later, if it's still
  // hidden then (a panel opening starts its glide just before the word
  // that its layer is shown arrives). Watching the page itself, not the
  // animations' own events: a hidden layer may draw no frames at all, and
  // then those never come.
  let later = 0;
  const settleSoon = () => {
    if (later) return;
    later = window.setTimeout(() => {
      later = 0;
      if (hidden) settle();
    }, 300);
  };
  const changes = new MutationObserver(settleSoon);
  const watch = (on: boolean) => {
    if (on)
      changes.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    else changes.disconnect();
  };
  window.firn.onLayerShown((shown) => {
    hidden = !shown;
    watch(hidden);
    if (hidden) settle();
    else {
      for (const animation of paused) animation.play();
      paused.clear();
    }
  });
  watch(hidden);
  if (hidden) settleSoon();
}
