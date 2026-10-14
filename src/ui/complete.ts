// Completing an address in the command bar from what's on this computer
// (open tabs and history; nothing is sent anywhere): typing "git" fills in
// "github.com", the added part selected, so typing on replaces it and
// Enter goes there.
//
// It completes to a site ("github.com") unless what's typed already goes
// past one ("github.com/dw" → "github.com/dwurgy/firn"), and never adds a
// "?…" or "#…" part (an address typed in full is left as it is). Text
// with a space is a search, never completed.

// An address as it reads in the box: no "https://", no "www.", no
// trailing slash on its own.
export function plainAddress(url: string) {
  return url
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '');
}

// `typed` completed from `urls` (best first), or null. The result starts
// with exactly what was typed, so only the rest is added.
export function completeAddress(typed: string, urls: string[]) {
  if (!typed || /\s/.test(typed)) return null;
  const lower = typed.toLowerCase();
  const pastSite = lower.includes('/');
  for (const url of urls) {
    if (!/^https?:\/\//i.test(url)) continue;
    const full = plainAddress(url.replace(/[?#].*$/, ''));
    const candidate = pastSite ? full : full.split('/')[0];
    if (
      candidate.length > typed.length &&
      candidate.toLowerCase().startsWith(lower)
    )
      return typed + candidate.slice(typed.length);
  }
  return null;
}
