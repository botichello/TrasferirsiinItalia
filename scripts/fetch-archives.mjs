/**
 * Wayback fallback fetcher. Queries the Internet Archive's availability API for
 * every source URL cited in the content, and writes a committed map
 * (src/data/archives.json) of url -> { archived, timestamp }.
 *
 * Why: the citability contract is only as strong as the links behind it. Live
 * gov URLs rot, and several official portals sit behind anti-bot protection that
 * blocks automated (and sometimes human) access. A dated archived snapshot is a
 * durable fallback that survives both — and archive.org is reachable where the
 * origin isn't.
 *
 * Not part of the build (needs network); run with `npm run fetch:archives` and
 * commit the result. A refresh adds and updates snapshots, keeps an old one when
 * the API misses, and drops URLs no longer cited anywhere. No deps.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { collectCitedUrls } from './lib/cited-urls.mjs';

const OUT = fileURLToPath(new URL('../src/data/archives.json', import.meta.url));
const TIMEOUT_MS = 25_000;
const ATTEMPTS = 3;
const CONCURRENCY = 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ask the Wayback Machine for the closest snapshot of `url`. */
async function closestSnapshot(url) {
  const api = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      const res = await fetch(api, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) {
        const data = await res.json();
        const snap = data?.archived_snapshots?.closest;
        if (snap?.available && String(snap.status) === '200' && snap.url) {
          return {
            archived: snap.url.replace(/^http:\/\//, 'https://'),
            timestamp: snap.timestamp || '',
          };
        }
        return null; // reachable API, but no usable snapshot
      }
    } catch {
      /* retry */
    }
    if (i < ATTEMPTS - 1) await sleep(1500 * (i + 1));
  }
  return null;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

// Every citation, not only the content collections' — the orientation pages,
// source-country notes and tracked figures are cited on /sources too, and a
// fallback is worth as much there.
const { urlToFiles } = await collectCitedUrls();
const list = [...urlToFiles.keys()].sort();
console.log(`Querying the Wayback Machine for ${list.length} source URL(s)…`);

const results = await pool(list, CONCURRENCY, async (url) => [url, await closestSnapshot(url)]);

// Merge with the existing map: the Wayback availability API is flaky, so a
// miss for a URL we already have a snapshot of keeps the old snapshot — a
// refresh must never silently drop an archived copy.
let existing = {};
try {
  existing = JSON.parse(await readFile(OUT, 'utf8'));
} catch {
  /* first run */
}
const map = {};
let found = 0;
for (const [url, snap] of results) {
  // "Closest" is not "newest": the API sometimes answers with an earlier
  // capture than the one already recorded, so never step a snapshot backwards.
  if (snap && existing[url] && snap.timestamp < existing[url].timestamp) {
    map[url] = existing[url];
  } else if (snap) {
    map[url] = snap;
    found++;
  } else if (existing[url]) {
    map[url] = existing[url];
  }
}
// Stable, sorted output for clean diffs.
const sorted = Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k]]));
await writeFile(OUT, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
console.log(
  `Wrote ${found}/${list.length} fresh snapshots (+${Object.keys(sorted).length - found} kept from previous run) to src/data/archives.json.`,
);
