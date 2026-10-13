// Scam and malware warnings, from Google Safe Browsing (the list Chrome,
// Firefox and Safari use), done the private way (its "Update API"):
//
// 1. Firn downloads Google's lists of dangerous sites and keeps them on this
//    computer, refreshed every half hour or so. They hold only the start of
//    a code made from each dangerous address (a 4-byte "hash prefix"), not
//    the addresses themselves.
// 2. Before a page loads, Firn makes the same kind of codes from its address
//    and looks them up in the lists, on this computer. Nearly always there's
//    no match and nothing more happens.
// 3. Only when the start of a code matches does Firn ask Google for the
//    full codes beginning that way, sending just those few bytes (shared by
//    many addresses, so they don't reveal which page it is), and compares
//    them here. Answers are remembered for as long as Google says.
//
// Nothing here depends on Electron. Without an API key, it does nothing.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type Threat = 'SOCIAL_ENGINEERING' | 'MALWARE' | 'UNWANTED_SOFTWARE';

const THREATS: Threat[] = [
  'SOCIAL_ENGINEERING',
  'MALWARE',
  'UNWANTED_SOFTWARE',
];
const PLATFORM = 'ANY_PLATFORM';

const API = 'https://safebrowsing.googleapis.com/v4';
// How long to wait for Google before letting a page load anyway.
const LOOKUP_TIMEOUT_MS = 5000;
const DEFAULT_UPDATE_WAIT_MS = 30 * 60 * 1000;

// --- Addresses to codes --------------------------------------------------------
// Safe Browsing's own rules for writing an address the same way every time
// ("canonicalization"), then the few host and path combinations to look up
// ("suffix/prefix expressions").

// Turns %XX into the character, over and over, until none are left.
function unescapeAll(text: string) {
  for (;;) {
    const next = text.replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
    if (next === text) return text;
    text = next;
  }
}

// Writes control characters, spaces, non-ASCII bytes, # and % as %XX.
function escapeOdd(text: string) {
  let out = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    out +=
      code <= 0x20 || code >= 0x7f || char === '#' || char === '%'
        ? '%' + code.toString(16).toUpperCase().padStart(2, '0')
        : char;
  }
  return out;
}

// Resolves "/./" and "/../", and turns "//" into "/".
function cleanPath(pathname: string) {
  const parts: string[] = [];
  const segments = pathname.split('/');
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment !== '') parts.push(segment);
    // A path ending in "/", "/." or "/.." keeps its trailing slash.
    if (last && (segment === '' || segment === '.' || segment === '..'))
      parts.push('');
  });
  const joined = '/' + parts.join('/');
  return joined.replace(/\/+$/, '/') || '/';
}

// The address, written Safe Browsing's way: host and path (with query),
// without scheme, port or #fragment. Null for addresses it doesn't cover.
export function canonicalize(
  url: string,
): { host: string; path: string; query: string | null } | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim().replace(/[\t\r\n]/g, ''));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  let host = unescapeAll(parsed.hostname)
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.')
    .toLowerCase();
  if (!host || host.startsWith('[')) return null;
  host = escapeOdd(host);
  // The query as written, including an empty one ("page?").
  const raw = parsed.href.split('#')[0];
  const queryAt = raw.indexOf('?');
  const query =
    queryAt === -1 ? null : escapeOdd(unescapeAll(raw.slice(queryAt + 1)));
  const path = escapeOdd(cleanPath(unescapeAll(parsed.pathname)));
  return { host, path, query };
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

// The combinations of host and path to look up for an address, e.g. for
// "http://a.b.c/1/2.html?x=1": a.b.c/1/2.html?x=1, a.b.c/1/2.html, a.b.c/,
// a.b.c/1/, and the same paths on b.c.
export function expressionsFor(url: string): string[] {
  const canon = canonicalize(url);
  if (!canon) return [];
  const { host, path, query } = canon;
  const hosts = [host];
  if (!IPV4.test(host)) {
    const parts = host.split('.');
    for (let i = Math.max(1, parts.length - 5); i <= parts.length - 2; i++)
      hosts.push(parts.slice(i).join('.'));
  }
  const paths: string[] = [];
  if (query !== null) paths.push(`${path}?${query}`);
  paths.push(path);
  const dirs = path.split('/').slice(1, -1);
  let prefix = '/';
  paths.push(prefix);
  for (const dir of dirs.slice(0, 3)) {
    prefix += `${dir}/`;
    paths.push(prefix);
  }
  const all = new Set<string>();
  for (const h of hosts) for (const p of paths) all.add(h + p);
  return [...all];
}

export function sha256(text: string | Buffer) {
  return createHash('sha256')
    .update(typeof text === 'string' ? Buffer.from(text, 'latin1') : text)
    .digest();
}

// --- One list, kept small ---------------------------------------------------
// The starts of codes Google sends, kept sorted. Almost all are 4 bytes,
// kept compactly as numbers; the few longer ones as hex text.

export class PrefixList {
  constructor(
    public short = new Uint32Array(0),
    public long: string[] = [],
  ) {}

  get size() {
    return this.short.length + this.long.length;
  }

  // Every entry in Google's order (sorted by bytes), as hex.
  *entries(): Generator<string> {
    let i = 0;
    let j = 0;
    while (i < this.short.length || j < this.long.length) {
      const shortHex =
        i < this.short.length
          ? this.short[i].toString(16).padStart(8, '0')
          : null;
      // A 4-byte entry comes before a longer one that starts the same way.
      if (
        shortHex !== null &&
        (j >= this.long.length || shortHex <= this.long[j])
      ) {
        yield shortHex;
        i++;
      } else {
        yield this.long[j++];
      }
    }
  }

  // Takes out the entries at these places (counted in Google's order).
  remove(indices: number[]) {
    if (!indices.length) return;
    const drop = new Set(indices);
    const short: number[] = [];
    const long: string[] = [];
    let k = 0;
    for (const hex of this.entries()) {
      if (!drop.has(k++)) {
        if (hex.length === 8) short.push(parseInt(hex, 16));
        else long.push(hex);
      }
    }
    this.short = Uint32Array.from(short);
    this.long = long;
  }

  // Adds entries: `bytes` holds them one after another, `size` bytes each.
  add(bytes: Buffer, size: number) {
    if (size < 4 || size > 32 || bytes.length % size)
      throw new Error('bad prefixes');
    const count = bytes.length / size;
    if (size === 4) {
      const merged = new Uint32Array(this.short.length + count);
      merged.set(this.short);
      for (let i = 0; i < count; i++)
        merged[this.short.length + i] = bytes.readUInt32BE(i * 4);
      merged.sort();
      this.short = merged;
    } else {
      for (let i = 0; i < count; i++)
        this.long.push(
          bytes.subarray(i * size, (i + 1) * size).toString('hex'),
        );
      this.long.sort();
    }
  }

  // Google's check that the list matches its own.
  checksum() {
    const hash = createHash('sha256');
    for (const hex of this.entries()) hash.update(Buffer.from(hex, 'hex'));
    return hash.digest('base64');
  }

  // The entry that a full code starts with, as hex, or null.
  match(full: Buffer): string | null {
    const head = full.readUInt32BE(0);
    let lo = 0;
    let hi = this.short.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.short[mid] === head) return full.subarray(0, 4).toString('hex');
      if (this.short[mid] < head) lo = mid + 1;
      else hi = mid - 1;
    }
    if (this.long.length) {
      const hex = full.toString('hex');
      for (const entry of this.long) if (hex.startsWith(entry)) return entry;
    }
    return null;
  }
}

// --- Talking to Google, and keeping the lists ------------------------------------

interface ListState {
  threat: Threat;
  // Google's marker for which version of the list Firn has.
  state: string;
}

interface SavedState {
  version: 1;
  lists: ListState[];
  nextUpdateAt: number;
}

type Fetch = typeof fetch;

export interface SafeBrowsingOptions {
  key: string;
  folder: string;
  clientVersion: string;
  // For tests: another server, and another way to fetch.
  api?: string;
  fetch?: Fetch;
  log?: (message: string) => void;
}

export class SafeBrowsing {
  private lists = new Map<Threat, PrefixList>();
  private states = new Map<Threat, string>();
  private nextUpdateAt = 0;
  private updateErrors = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Full codes Google confirmed, and starts of codes it said are fine, with
  // when to forget them.
  private dangerous = new Map<string, { threat: Threat; until: number }>();
  private safe = new Map<string, number>();
  // Google asked Firn not to ask again before this.
  private lookupsWaitUntil = 0;
  private lookupErrors = 0;
  private running = false;
  private api: string;
  private fetch: Fetch;
  private log: (message: string) => void;

  constructor(private options: SafeBrowsingOptions) {
    this.api = options.api ?? API;
    this.fetch = options.fetch ?? fetch;
    this.log = options.log ?? (() => {});
  }

  // Whether this copy of Firn has a key for Google's service.
  get available() {
    return !!this.options.key;
  }

  get enabled() {
    return this.available && this.running;
  }

  // Loads the lists saved last time, then keeps them fresh.
  start() {
    if (!this.available || this.running) return;
    this.running = true;
    this.load();
    this.schedule(Math.max(0, this.nextUpdateAt - Date.now()));
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // Whether the lists have arrived yet (until they do, nothing is flagged).
  get ready() {
    return [...this.lists.values()].some((list) => list.size > 0);
  }

  // What's dangerous about an address, or null if nothing is known.
  // Resolves quickly: on this computer, unless a code's start matches.
  async check(url: string): Promise<Threat | null> {
    if (!this.enabled || !this.ready) return null;
    const hashes = expressionsFor(url).map((e) => sha256(e));
    const now = Date.now();
    const toAsk = new Set<string>();
    for (const full of hashes) {
      const fullHex = full.toString('hex');
      for (const list of this.lists.values()) {
        const prefix = list.match(full);
        if (!prefix) continue;
        const known = this.dangerous.get(fullHex);
        if (known && known.until > now) return known.threat;
        if ((this.safe.get(prefix) ?? 0) > now) continue;
        toAsk.add(prefix);
      }
    }
    if (!toAsk.size) return null;
    await this.findFullHashes([...toAsk]);
    for (const full of hashes) {
      const known = this.dangerous.get(full.toString('hex'));
      if (known && known.until > Date.now()) return known.threat;
    }
    return null;
  }

  private client() {
    return { clientId: 'firn', clientVersion: this.options.clientVersion };
  }

  private async post(method: string, body: unknown, timeoutMs?: number) {
    const response = await this.fetch(
      `${this.api}/${method}?key=${encodeURIComponent(this.options.key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
      },
    );
    if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }

  // Asks Google for the full codes starting with these (see 3. above).
  private async findFullHashes(prefixes: string[]) {
    if (Date.now() < this.lookupsWaitUntil) return;
    try {
      const reply = await this.post(
        'fullHashes:find',
        {
          client: this.client(),
          clientStates: [...this.states.values()],
          threatInfo: {
            threatTypes: [...this.lists.keys()],
            platformTypes: [PLATFORM],
            threatEntryTypes: ['URL'],
            threatEntries: prefixes.map((p) => ({
              hash: Buffer.from(p, 'hex').toString('base64'),
            })),
          },
        },
        LOOKUP_TIMEOUT_MS,
      );
      this.lookupErrors = 0;
      const now = Date.now();
      const matches = Array.isArray(reply.matches) ? reply.matches : [];
      for (const match of matches as Record<string, unknown>[]) {
        const threat = match.threatType as Threat;
        const hash = (match.threat as { hash?: string } | undefined)?.hash;
        if (!THREATS.includes(threat) || typeof hash !== 'string') continue;
        this.dangerous.set(Buffer.from(hash, 'base64').toString('hex'), {
          threat,
          until: now + seconds(match.cacheDuration, 300) * 1000,
        });
      }
      const fineFor = seconds(reply.negativeCacheDuration, 300) * 1000;
      for (const prefix of prefixes) this.safe.set(prefix, now + fineFor);
      const wait = seconds(reply.minimumWaitDuration, 0);
      if (wait) this.lookupsWaitUntil = now + wait * 1000;
    } catch (error) {
      // Google can't be reached: the page loads (as in other browsers), and
      // Firn waits a little longer each time before asking again.
      this.lookupErrors++;
      this.lookupsWaitUntil =
        Date.now() + Math.min(30 * 60, 30 * 2 ** this.lookupErrors) * 1000;
      this.log(`lookup failed: ${String(error)}`);
    }
  }

  private schedule(delayMs: number) {
    if (this.timer) clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(() => void this.update(), delayMs);
    this.timer.unref?.();
  }

  // Fetches what's changed in the lists since last time.
  async update() {
    if (!this.enabled) return;
    try {
      const reply = await this.post('threatListUpdates:fetch', {
        client: this.client(),
        listUpdateRequests: THREATS.map((threat) => ({
          threatType: threat,
          platformType: PLATFORM,
          threatEntryType: 'URL',
          state: this.states.get(threat) ?? '',
          constraints: { supportedCompressions: ['RAW'] },
        })),
      });
      const responses = Array.isArray(reply.listUpdateResponses)
        ? (reply.listUpdateResponses as Record<string, unknown>[])
        : [];
      for (const response of responses) this.applyUpdate(response);
      this.updateErrors = 0;
      const wait = seconds(reply.minimumWaitDuration, 0) * 1000;
      this.nextUpdateAt = Date.now() + Math.max(wait, DEFAULT_UPDATE_WAIT_MS);
      this.save();
      this.log(
        `lists updated: ${[...this.lists].map(([t, l]) => `${t} ${l.size}`).join(', ')}`,
      );
    } catch (error) {
      // Tries again later, waiting longer each time (15 minutes, then 30,
      // an hour... up to a day), as Google asks.
      this.updateErrors++;
      const minutes = Math.min(24 * 60, 15 * 2 ** (this.updateErrors - 1));
      this.nextUpdateAt =
        Date.now() + minutes * 60 * 1000 * (1 + Math.random());
      this.log(`update failed: ${String(error)}`);
    }
    this.schedule(Math.max(0, this.nextUpdateAt - Date.now()));
  }

  private applyUpdate(response: Record<string, unknown>) {
    const threat = response.threatType as Threat;
    if (!THREATS.includes(threat)) return;
    const list =
      response.responseType === 'FULL_UPDATE'
        ? new PrefixList()
        : (this.lists.get(threat) ?? new PrefixList());
    try {
      for (const removal of (response.removals as Record<string, unknown>[]) ??
        []) {
        const indices = (
          removal.rawIndices as { indices?: number[] } | undefined
        )?.indices;
        if (indices) list.remove(indices);
      }
      for (const addition of (response.additions as Record<
        string,
        unknown
      >[]) ?? []) {
        const raw = addition.rawHashes as
          | { prefixSize?: number; rawHashes?: string }
          | undefined;
        if (raw?.rawHashes && raw.prefixSize)
          list.add(Buffer.from(raw.rawHashes, 'base64'), raw.prefixSize);
      }
      const expected = (response.checksum as { sha256?: string } | undefined)
        ?.sha256;
      if (expected && list.checksum() !== expected) throw new Error('checksum');
    } catch (error) {
      // Out of step with Google: start this list over next time.
      this.lists.delete(threat);
      this.states.delete(threat);
      this.log(`${threat} list reset: ${String(error)}`);
      return;
    }
    this.lists.set(threat, list);
    this.states.set(threat, String(response.newClientState ?? ''));
  }

  // --- On disk: state.json, and one small file per list -------------------------

  private file(name: string) {
    return path.join(this.options.folder, name);
  }

  private load() {
    try {
      const saved = JSON.parse(
        fs.readFileSync(this.file('state.json'), 'utf8'),
      ) as SavedState;
      if (saved.version !== 1) return;
      for (const { threat, state } of saved.lists) {
        if (!THREATS.includes(threat)) continue;
        const short = fs.readFileSync(this.file(`${threat}.bin`));
        const long = JSON.parse(
          fs.readFileSync(this.file(`${threat}.long.json`), 'utf8'),
        ) as string[];
        const numbers = new Uint32Array(short.length / 4);
        for (let i = 0; i < numbers.length; i++)
          numbers[i] = short.readUInt32BE(i * 4);
        this.lists.set(threat, new PrefixList(numbers, long));
        this.states.set(threat, state);
      }
      this.nextUpdateAt = saved.nextUpdateAt || 0;
    } catch {
      // Nothing saved yet (or unreadable): fetch the lists afresh.
      this.lists.clear();
      this.states.clear();
    }
  }

  private save() {
    try {
      fs.mkdirSync(this.options.folder, { recursive: true });
      const lists: ListState[] = [];
      for (const [threat, list] of this.lists) {
        const short = Buffer.alloc(list.short.length * 4);
        list.short.forEach((n, i) => short.writeUInt32BE(n, i * 4));
        writeWhole(this.file(`${threat}.bin`), short);
        writeWhole(this.file(`${threat}.long.json`), JSON.stringify(list.long));
        lists.push({ threat, state: this.states.get(threat) ?? '' });
      }
      const state: SavedState = {
        version: 1,
        lists,
        nextUpdateAt: this.nextUpdateAt,
      };
      // Last, so it only ever describes lists already saved in full.
      writeWhole(this.file('state.json'), JSON.stringify(state));
    } catch (error) {
      this.log(`could not save lists: ${String(error)}`);
    }
  }
}

// Writes a file whole: to a temporary file first, then swapped in, so a
// crash mid-write can't leave half a list behind.
function writeWhole(file: string, data: string | Buffer) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, file);
}

// "593.44s" → 593.44 (Google writes durations this way).
function seconds(value: unknown, fallback: number) {
  if (typeof value !== 'string') return fallback;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}
