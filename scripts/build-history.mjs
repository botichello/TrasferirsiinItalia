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
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
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

writeFileSync(OUT, JSON.stringify(history, null, 1) + '\n');
const total = Object.values(history).reduce((n, e) => n + e.length, 0);
console.log(`✓ history.json: ${total} verification events across ${Object.keys(history).length} files`);
