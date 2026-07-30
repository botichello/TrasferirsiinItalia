#!/usr/bin/env node
/**
 * Self-test for the build gates: proves scripts/check-seo.mjs and
 * scripts/check-freshness.mjs actually fail on the breakage they claim to
 * catch.
 *
 * Why this exists. In step 38 a completeness scan was added to the freshness
 * gate; it reported success on 24 files while genuinely checking 14, because
 * the pattern it matched never fired. Every build was green and the gate was
 * worthless. A passing gate is not evidence — it is only evidence once you
 * have watched it fail on purpose.
 *
 * So: copy the gate's input (dist/ for check-seo, src/ for check-freshness),
 * inject one specific fault per case, run the gate against the copy, and assert
 * it reports the matching error. A rule that stops firing (refactor, changed
 * selector, typo in a regex) fails here loudly instead of degrading into silent
 * false comfort.
 *
 * Usage: node scripts/test-gates.mjs   (needs a completed build in dist/)
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const SRC = join(ROOT, 'src');
const SEO_GATE = join(ROOT, 'scripts/check-seo.mjs');
const FRESHNESS_GATE = join(ROOT, 'scripts/check-freshness.mjs');

if (!existsSync(DIST)) {
  console.error('test-gates: dist/ not found — run the build first.');
  process.exit(1);
}

/** Run `script` against the copy in `dir` via `envVar`; return {ok, output}. */
function runGate(script, envVar, dir) {
  try {
    const out = execFileSync('node', [script], {
      cwd: ROOT,
      encoding: 'utf8',
      // Capture the child's output instead of letting it reach our console:
      // a failing gate is the *expected* result here, not something to report.
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, [envVar]: dir },
    });
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, output: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const write = (dir, rel, s) => writeFileSync(join(dir, rel), s);
/** Replace the first occurrence of `find` in a built file. */
const patch = (dir, rel, find, replace) => {
  const s = read(dir, rel);
  if (!s.includes(find)) throw new Error(`fixture drift: ${rel} does not contain ${find}`);
  write(dir, rel, s.replace(find, replace));
};

const HOME = 'index.html';
const GUIDE = 'eu-citizens/residency/codice-fiscale/index.html';
const ORIENT = 'banking/index.html';

// Each case: inject one fault, expect the gate to report `expect`.
const seoCases = [
  {
    name: 'canonical missing',
    expect: '0 canonical tags',
    break: (d) => patch(d, HOME, '<link rel="canonical"', '<link rel="not-canonical"'),
  },
  {
    name: 'canonical duplicated',
    expect: '2 canonical tags',
    break: (d) => {
      const s = read(d, HOME);
      const tag = s.match(/<link rel="canonical"[^>]*>/)[0];
      write(d, HOME, s.replace(tag, tag + tag));
    },
  },
  {
    name: 'canonical not absolute',
    expect: 'canonical not absolute',
    // Rewrite the canonical tag itself: the absolute site URL also appears in
    // og:url and the JSON-LD, so a plain first-occurrence replace hits those.
    break: (d) => {
      const s = read(d, HOME);
      write(d, HOME, s.replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="/">'));
    },
  },
  {
    name: 'canonical points off-site',
    expect: 'canonical off-site',
    break: (d) =>
      patch(d, ORIENT, 'rel="canonical" href="https://www.trasferirsiinitalia.com/banking"', 'rel="canonical" href="https://example.com/banking"'),
  },
  {
    name: 'JSON-LD malformed',
    expect: 'JSON-LD does not parse',
    break: (d) => patch(d, HOME, '{"@context"', '{{"@context"'),
  },
  {
    name: 'title empty',
    expect: 'missing or empty <title>',
    break: (d) => patch(d, HOME, '<title>', '<title></title><s>'),
  },
  {
    name: 'meta description empty',
    expect: 'missing or empty meta description',
    break: (d) => patch(d, HOME, '<meta name="description" content="', '<meta name="description" content2="'),
  },
  {
    name: 'og:image missing',
    expect: 'missing og:image',
    break: (d) => patch(d, HOME, '<meta property="og:image"', '<meta property="og:imagex"'),
  },
  {
    name: 'page rendered without Vercel Analytics',
    expect: 'missing Vercel Analytics element',
    break: (d) => patch(d, GUIDE, '<vercel-analytics', '<not-analytics'),
  },
  {
    name: 'og:image file absent from dist',
    expect: 'og:image file missing from dist',
    break: (d) => unlinkSync(join(d, 'og/banking.png')),
  },
  {
    name: 'hreflang code typo (was invisible to the URL-only check)',
    expect: 'unexpected hreflang code: xx',
    break: (d) =>
      patch(d, 'it/banking/index.html', '<link rel="alternate" hreflang="en"', '<link rel="alternate" hreflang="xx"'),
  },
  {
    name: 'hreflang set not reciprocated by the twin',
    expect: 'not reciprocated',
    break: (d) =>
      patch(d, 'it/banking/index.html', 'hreflang="it" href="https://www.trasferirsiinitalia.com/it/banking"', 'hreflang="it" href="https://www.trasferirsiinitalia.com/it/driving"'),
  },
  {
    name: 'hreflang points to a page that does not exist',
    expect: 'points to missing page',
    break: (d) =>
      patch(d, ORIENT, 'hreflang="it" href="https://www.trasferirsiinitalia.com/it/banking"', 'hreflang="it" href="https://www.trasferirsiinitalia.com/it/nope"'),
  },
  {
    name: 'internal link to nothing',
    expect: 'internal link to nothing',
    break: (d) => patch(d, ORIENT, '<a href="/glossary"', '<a href="/does-not-exist"'),
  },
  {
    name: 'broken #fragment',
    expect: 'broken fragment',
    break: (d) => patch(d, ORIENT, '<a href="/glossary"', '<a href="/glossary#no-such-anchor"'),
  },
  {
    name: 'orientation page missing Article schema',
    expect: 'missing Article JSON-LD',
    break: (d) => patch(d, ORIENT, '"@type":"Article"', '"@type":"Nothing"'),
  },
  {
    name: 'orientation page missing BreadcrumbList',
    expect: 'missing BreadcrumbList JSON-LD',
    break: (d) => patch(d, ORIENT, '"@type":"BreadcrumbList"', '"@type":"Nothing"'),
  },
  {
    name: 'orientation dateModified drifts from the registry',
    expect: '!= registry lastVerified',
    break: (d) => patch(d, ORIENT, '"dateModified":"2026-07-28"', '"dateModified":"2020-01-01"'),
  },
  {
    name: 'guide loses its HowTo schema (JSON-LD still parses)',
    expect: 'JSON-LD does not parse',
    break: (d) => patch(d, GUIDE, '"@graph"', '"@graph"broken'),
  },
  {
    name: 'sitemap advertises a page that was not built',
    expect: 'in sitemap but no page built',
    break: (d) =>
      patch(d, 'sitemap-0.xml', '<url><loc>https://www.trasferirsiinitalia.com/banking</loc>', '<url><loc>https://www.trasferirsiinitalia.com/ghost-page</loc>'),
  },
];

// ---- Freshness gate: same idea, but its input is src/ rather than dist/ ------
// This is the gate whose completeness scan once passed while checking nothing,
// so it is the one that most needs proving.
const MD = 'src/content/guides/codice-fiscale.md';
const REGISTRY = 'src/data/orientation-pages.mjs';
const PAGE = 'src/pages/banking.astro';

const freshnessCases = [
  {
    name: 'guide with no frontmatter',
    expect: 'no frontmatter found',
    break: (d) => write(d, MD, read(d, MD).replace(/^---\n/, '')),
  },
  {
    name: 'guide missing sources',
    expect: 'missing required `sources`',
    break: (d) => patch(d, MD, '\nsources:', '\nnotsources:'),
  },
  {
    name: 'guide missing lastVerified',
    expect: 'missing `lastVerified`',
    break: (d) => patch(d, MD, 'lastVerified:', 'notLastVerified:'),
  },
  {
    name: 'reviewBy not after lastVerified',
    expect: '`reviewBy` must be after `lastVerified`',
    break: (d) => write(d, MD, read(d, MD).replace(/^reviewBy: .*$/m, 'reviewBy: 2000-01-01')),
  },
  {
    name: 'registered orientation page deleted',
    expect: 'does not exist',
    break: (d) => unlinkSync(join(d, PAGE)),
  },
  {
    name: 'on-page verified date drifts from the registry',
    expect: '!= registry lastVerified',
    break: (d) => patch(d, PAGE, '<time datetime="2026-07-28"', '<time datetime="2019-05-05"'),
  },
  {
    name: 'orientation page not registered',
    expect: 'not registered in src/data/orientation-pages.mjs',
    break: (d) =>
      write(d, REGISTRY, read(d, REGISTRY).replace(/\n *\{ en: 'src\/pages\/banking\.astro'[\s\S]*?\},/, '')),
  },
  {
    name: 'registered page loses its disclaimer',
    expect: 'missing the disclaimer sentinel',
    break: (d) => patch(d, PAGE, 'orientation, not\n      legal or financial advice', 'no disclaimer here'),
  },
];

const suites = [
  {
    label: 'check-seo',
    input: DIST,
    // check-seo resolves paths under DIST, and its own default ends in a slash.
    envVar: 'CHECK_SEO_DIST',
    arg: (dir) => dir + '/',
    script: SEO_GATE,
    cases: seoCases,
  },
  {
    label: 'check-freshness',
    input: SRC,
    // Copied as <tmp>/src, so the gate's ROOT is the tmp dir itself.
    envVar: 'CHECK_FRESHNESS_ROOT',
    arg: (dir) => dir,
    script: FRESHNESS_GATE,
    into: 'src',
    cases: freshnessCases,
  },
];

let failures = 0;
let total = 0;

for (const suite of suites) {
  const stage = (dir) => cpSync(suite.input, suite.into ? join(dir, suite.into) : dir, { recursive: true });
  const run = (dir) => runGate(suite.script, suite.envVar, suite.arg(dir));

  // Sanity: the pristine copy must pass, or every case below is meaningless.
  const clean = mkdtempSync(join(tmpdir(), 'gate-clean-'));
  stage(clean);
  const baseline = run(clean);
  rmSync(clean, { recursive: true, force: true });
  if (!baseline.ok) {
    console.error(`✗ ${suite.label} baseline: fails on unmodified input — fix that first:\n`);
    console.error(baseline.output.split('\n').slice(0, 12).join('\n'));
    process.exit(1);
  }
  console.log(`\n✓ ${suite.label}: unmodified input passes`);

  for (const c of suite.cases) {
    total++;
    const dir = mkdtempSync(join(tmpdir(), 'gate-case-'));
    try {
      stage(dir);
      // Case paths are relative to the staged root (freshness cases include the
      // leading 'src/'), so every case works from `dir`.
      c.break(dir);
      const { ok, output } = run(dir);
      if (ok) {
        console.error(`✗ ${c.name}: gate PASSED but should have failed (expected "${c.expect}")`);
        failures++;
      } else if (!output.includes(c.expect)) {
        console.error(`✗ ${c.name}: gate failed, but not with "${c.expect}". Got:`);
        console.error(
          output
            .split('\n')
            .filter((l) => l.trim().startsWith('/') || l.trim().startsWith('- ') || l.includes('problem'))
            .slice(0, 4)
            .join('\n'),
        );
        failures++;
      } else {
        console.log(`  ✓ ${c.name}`);
      }
    } catch (e) {
      console.error(`✗ ${c.name}: could not inject the fault — ${e.message}`);
      failures++;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

if (failures > 0) {
  console.error(`\n✗ test-gates: ${failures} of ${total} rule(s) did not fire as expected.`);
  process.exit(1);
}
console.log(`\n✓ test-gates: all ${total} gate rules proven to fire (check-seo + check-freshness).`);
