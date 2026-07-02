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
 * commit the result. Re-running only ever adds/refreshes entries. No deps.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT_DIRS = [
  fileURLToPath(new URL('../src/content/guides/', import.meta.url)),
  fileURLToPath(new URL('../src/content/region-notes/', import.meta.url)),
  fileURLToPath(new URL('../src/content/comune-notes/', import.meta.url)),
];
const OUT = fileURLToPath(new URL('../src/data/archives.json', import.meta.url));
const TIMEOUT_MS = 25_000;
const ATTEMPTS = 3;
const CONCURRENCY = 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

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

const files = (await Promise.all(CONTENT_DIRS.map(walk))).flat();
const urls = new Set();
const urlRe = /^\s*url:\s*(['"]?)(https?:\/\/[^'"\s]+)\1/gm;
for (const path of files) {
  const raw = await readFile(path, 'utf8');
  for (const m of raw.matchAll(urlRe)) urls.add(m[2]);
}
const list = [...urls].sort();
console.log(`Querying the Wayback Machine for ${list.length} source URL(s)…`);

const results = await pool(list, CONCURRENCY, async (url) => [url, await closestSnapshot(url)]);

const map = {};
let found = 0;
for (const [url, snap] of results) {
  if (snap) {
    map[url] = snap;
    found++;
  }
}
// Stable, sorted output for clean diffs.
const sorted = Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k]]));
await writeFile(OUT, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
console.log(`Wrote ${found}/${list.length} archived snapshots to src/data/archives.json.`);
