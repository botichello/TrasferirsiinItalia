#!/usr/bin/env node
/**
 * Build src/data/history.json — the verification history of every content
 * file, derived from git: one event per commit in which the file's
 * `lastVerified` frontmatter changed (i.e. a human re-confirmed the content
 * against its sources). Powers the /updates page and the per-guide
 * verification history, so "dated and verified" is provable, not asserted.
 *
 * Committed like archives.json (Vercel's shallow clones can't derive it at
 * build time). Refresh after verification passes: npm run build:history
 *
 * MERGES, NEVER DROPS — for the same reason fetch:archives does. What git can
 * see depends on how the repository was cloned, and a shallow clone sees only
 * the recent tail. Run here, a plain rebuild rewrote 316 events as 194: the
 * 122 verifications older than the clone's first commit simply vanished, and
 * the file it deleted them from is the site's proof that it is verified at all.
 * Nothing would have failed. CONTRIBUTING tells every contributor to run this
 * after a verification pass, so the failure was one `git clone --depth` away
 * from anybody.
 *
 * So: the git-derived history is unioned with whatever is already committed,
 * an event being identified by (file, verified date). The result can grow and
 * can correct a subject line, but can never shrink — and if the tree is
 * shallow, the script says so rather than quietly doing less.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CONTENT = join(ROOT, 'src/content');
const OUT = join(ROOT, 'src/data/history.json');

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function mdFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return mdFiles(p);
    return name.endsWith('.md') ? [p] : [];
  });
}

const history = {};
for (const file of mdFiles(CONTENT)) {
  const rel = relative(CONTENT, file);
  const relRepo = relative(ROOT, file);
  // Oldest → newest commits touching this file (following renames).
  const log = git('log', '--reverse', '--follow', '--format=%H\t%cs\t%s', '--', relRepo)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, date, ...subject] = l.split('\t');
      return { sha, date, subject: subject.join('\t') };
    });

  const events = [];
  let prev;
  for (const { sha, date, subject } of log) {
    let verified;
    try {
      verified = git('show', `${sha}:${relRepo}`).match(/^lastVerified:\s*(\S+)/m)?.[1];
    } catch {
      continue; // file didn't exist at this path in that commit (pre-rename)
    }
    if (verified && verified !== prev) {
      events.push({ verified, committed: date, subject });
      prev = verified;
    }
  }
  if (events.length > 0) history[rel] = events;
}

// Orientation pages (src/pages/*.astro, tracked via the registry): one event
// per commit in which the page's visible <time datetime="…"> changed. Keyed
// as `pages/<path under src/pages>` — disjoint from the content keys above.
const { orientationPages } = await import(new URL('../src/data/orientation-pages.mjs', import.meta.url));
for (const entry of orientationPages) {
  const relRepo = entry.en;
  const key = 'pages/' + relRepo.replace(/^src\/pages\//, '');
  const log = git('log', '--reverse', '--follow', '--format=%H\t%cs\t%s', '--', relRepo)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, date, ...subject] = l.split('\t');
      return { sha, date, subject: subject.join('\t') };
    });
  const events = [];
  let prev;
  for (const { sha, date, subject } of log) {
    let verified;
    try {
      verified = git('show', `${sha}:${relRepo}`).match(/<time datetime="(\d{4}-\d{2}-\d{2})"/)?.[1];
    } catch {
      continue;
    }
    if (verified && verified !== prev) {
      events.push({ verified, committed: date, subject });
      prev = verified;
    }
  }
  if (events.length > 0) history[key] = events;
}

// ---- Merge with what is already committed -----------------------------------
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const shallow = git('rev-parse', '--is-shallow-repository').trim() === 'true';

const merged = {};
let recovered = 0;
for (const key of new Set([...Object.keys(previous), ...Object.keys(history)])) {
  const byDate = new Map();
  // Derived first, committed second, so the committed record wins a tie. That
  // ordering matters: in a shallow clone the oldest visible commit merely
  // *contains* a file, so its subject line describes the wrong change. The
  // already-recorded subject was written when the tree was whole.
  for (const e of history[key] ?? []) byDate.set(e.verified, e);
  const derived = new Set((history[key] ?? []).map((e) => e.verified));
  for (const e of previous[key] ?? []) byDate.set(e.verified, e);
  recovered += (previous[key] ?? []).filter((e) => !derived.has(e.verified)).length;
  merged[key] = [...byDate.values()].sort((a, b) => (a.verified < b.verified ? -1 : 1));
}

const count = (h) => Object.values(h).reduce((n, e) => n + e.length, 0);
const before = count(previous);
const after = count(merged);
if (after < before) {
  console.error(`✗ history.json: refusing to write ${after} events over ${before} — the log must never shrink.`);
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify(merged, null, 1) + '\n');
console.log(`✓ history.json: ${after} verification events across ${Object.keys(merged).length} files` + (after > before ? ` (+${after - before})` : ''));
if (recovered > 0) {
  console.log(
    `  ${recovered} event(s) kept from the committed file that this checkout cannot derive` +
      (shallow ? ' — the repository is a shallow clone.' : '.'),
  );
  if (shallow) console.log('  For a full rebuild from git, run: git fetch --unshallow');
}
