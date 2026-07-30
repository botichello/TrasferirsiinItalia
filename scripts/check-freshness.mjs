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
import { fileURLToPath, pathToFileURL } from 'node:url';

// Repo root. Overridable so scripts/test-gates.mjs can run this gate against a
// deliberately broken copy of src/ and assert each rule fires.
const ROOT = process.env.CHECK_FRESHNESS_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const CONTENT_DIRS = [
  join(ROOT, 'src/content/guides/'),
  join(ROOT, 'src/content/region-notes/'),
  join(ROOT, 'src/content/comune-notes/'),
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
  const file = relative(ROOT, path);
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

// ---- Orientation pages (src/pages/*.astro outside the collections) --------
// Same contract, tracked via the registry in src/data/orientation-pages.mjs.
const { orientationPages } = await import(
  pathToFileURL(join(ROOT, 'src/data/orientation-pages.mjs')).href
);
// Orientation pages carry a disclaimer line. Match it on whitespace-normalized
// text: in the source the phrase wraps across lines, and the tail varies
// ("not legal advice" / "not legal or financial advice"), so a plain substring
// test silently missed most pages — which would have let an unregistered page
// through the completeness scan below.
const SENTINELS = [
  /orientation, not legal (or \w+ )?advice/,
  /orientamento, non consulenza legale/,
];
const hasSentinel = (raw) => {
  const flat = raw.replace(/\s+/g, ' ').toLowerCase();
  return SENTINELS.some((re) => re.test(flat));
};
const registered = new Set();

for (const entry of orientationPages) {
  for (const [lang, rel] of [['en', entry.en], ['it', entry.it]]) {
    registered.add(rel);
    let raw;
    try {
      raw = await readFile(join(ROOT, rel), 'utf8');
    } catch {
      errors.push(`${rel}: registered orientation page (${lang}) does not exist`);
      continue;
    }
    // The visible date on the page must match the registry.
    const onPage = raw.match(/<time datetime="(\d{4}-\d{2}-\d{2})"/)?.[1];
    if (onPage && onPage !== entry.lastVerified) {
      errors.push(
        `${rel}: on-page verified date ${onPage} != registry lastVerified ${entry.lastVerified}`,
      );
    }
  }
  const lv = new Date(entry.lastVerified);
  const rb = new Date(entry.reviewBy);
  if (!(rb > lv)) errors.push(`${entry.en}: registry \`reviewBy\` must be after \`lastVerified\``);
  if (new Date() > rb) {
    const msg = `${entry.en}: orientation review overdue (reviewBy ${entry.reviewBy})`;
    (STRICT_OVERDUE ? errors : warnings).push(msg);
  }
}

// Completeness: any page carrying the orientation sentinel must be registered.
async function walkAstro(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkAstro(full)));
    else if (e.name.endsWith('.astro')) out.push(full);
  }
  return out;
}
for (const path of await walkAstro(join(ROOT, 'src/pages'))) {
  const raw = await readFile(path, 'utf8');
  const rel = relative(ROOT, path);
  if (hasSentinel(raw)) {
    if (!registered.has(rel)) {
      errors.push(`${rel}: orientation page not registered in src/data/orientation-pages.mjs`);
    }
  } else if (registered.has(rel)) {
    // The inverse guard: a registered page that lost its disclaimer would also
    // silently drop out of the scan above, so require it to keep one.
    errors.push(`${rel}: registered orientation page is missing the disclaimer sentinel`);
  }
}

for (const w of warnings) console.warn(`⚠️  ${w}`);

if (errors.length) {
  console.error('\n✗ Freshness check failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `✓ Freshness check passed (${files.length} content files + ${orientationPages.length} orientation pages` +
    (warnings.length ? `, ${warnings.length} overdue warning(s)` : '') +
    ').',
);
