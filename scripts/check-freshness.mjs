/**
 * Freshness gate. Runs before the build (see package.json `build` script) and
 * in CI (see .github/workflows/freshness.yml).
 *
 * - FAILS the build if any guide page is missing sources or required dates, or
 *   if `reviewBy` is not after `lastVerified` (defence in depth alongside the
 *   Zod content schema).
 * - WARNS (without failing the local/CI build) when a page is past its
 *   `reviewBy` date, so stale content is surfaced loudly rather than silently
 *   trusted. The scheduled CI job turns these warnings into a visible signal.
 *
 * No dependencies — deliberately tiny so it can run anywhere.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT_DIRS = [
  fileURLToPath(new URL('../src/content/guides/', import.meta.url)),
  fileURLToPath(new URL('../src/content/region-notes/', import.meta.url)),
];
const STRICT_OVERDUE = process.env.FRESHNESS_STRICT === '1';

/** Recursively collect all .md files under a directory. */
async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // directory may not exist yet
  }
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Minimal frontmatter reader — enough for our flat-ish guide frontmatter. */
function frontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  let currentKey = null;
  for (const line of match[1].split('\n')) {
    const top = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (top) {
      currentKey = top[1];
      fm[currentKey] = top[2] === '' ? [] : top[2].replace(/^['"]|['"]$/g, '');
    } else if (/^\s*-\s+/.test(line) && Array.isArray(fm[currentKey])) {
      fm[currentKey].push(line.replace(/^\s*-\s+/, ''));
    }
  }
  return fm;
}

const files = (await Promise.all(CONTENT_DIRS.map(walk))).flat();
const errors = [];
const warnings = [];

for (const path of files) {
  const file = relative(process.cwd(), path);
  const raw = await readFile(path, 'utf8');
  const fm = frontmatter(raw);
  if (!fm) {
    errors.push(`${file}: no frontmatter found`);
    continue;
  }

  if (!/\nsources:/.test(raw)) {
    errors.push(`${file}: missing required \`sources\``);
  }
  if (!fm.lastVerified) errors.push(`${file}: missing \`lastVerified\``);
  if (!fm.reviewBy) errors.push(`${file}: missing \`reviewBy\``);

  if (fm.lastVerified && fm.reviewBy) {
    const lv = new Date(fm.lastVerified);
    const rb = new Date(fm.reviewBy);
    if (!(rb > lv)) errors.push(`${file}: \`reviewBy\` must be after \`lastVerified\``);
    if (new Date() > rb) {
      const msg = `${file}: review overdue (reviewBy ${fm.reviewBy})`;
      (STRICT_OVERDUE ? errors : warnings).push(msg);
    }
  }
}

for (const w of warnings) console.warn(`⚠️  ${w}`);

if (errors.length) {
  console.error('\n✗ Freshness check failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `✓ Freshness check passed (${files.length} content file${files.length === 1 ? '' : 's'}` +
    (warnings.length ? `, ${warnings.length} overdue warning(s)` : '') +
    ').',
);
