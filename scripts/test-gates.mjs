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
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const SRC = join(ROOT, 'src');
const SEO_GATE = join(ROOT, 'scripts/check-seo.mjs');
const JOURNEY_GATE = join(ROOT, 'scripts/check-journeys.mjs');
const FRESHNESS_GATE = join(ROOT, 'scripts/check-freshness.mjs');
const FIGURES_GATE = join(ROOT, 'scripts/check-figures.mjs');
const THEME_GATE = join(ROOT, 'scripts/check-theme.mjs');
const TWINS_GATE = join(ROOT, 'scripts/check-twins.mjs');
const PROSE_GATE = join(ROOT, 'scripts/check-prose.mjs');

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

/** Rewrite all three copies of a page's description in the built HTML. */
const setDescription = (dir, rel, text) => {
  const before = read(dir, rel);
  const after = before
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${text}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${text}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${text}">`);
  if (after === before) throw new Error(`fixture drift: ${rel} has no description meta tags`);
  write(dir, rel, after);
};

/** Rewrite every `href="<target>"` in the built tree to `replacement`. */
const stripLinks = (dir, target, replacement = '/nowhere-at-all', under = '') => {
  let touched = 0;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.html')) {
        const s = readFileSync(p, 'utf8');
        if (!s.includes(`href="${target}"`)) continue;
        writeFileSync(p, s.replaceAll(`href="${target}"`, `href="${replacement}"`));
        touched++;
      }
    }
  };
  walk(under ? join(dir, under) : dir);
  if (touched === 0) throw new Error(`fixture drift: nothing under ${under || '/'} links to ${target}`);
};

/** Replace every occurrence of a literal across the staged source tree. */
const stripLiteral = (dir, literal, replacement) => {
  let touched = 0;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(md|astro|ts|mjs)$/.test(name) && p !== join(dir, 'src/data/figures.mjs')) {
        const s = readFileSync(p, 'utf8');
        if (!s.includes(literal)) continue;
        writeFileSync(p, s.replaceAll(literal, replacement));
        touched++;
      }
    }
  };
  walk(join(dir, 'src'));
  if (touched === 0) throw new Error(`fixture drift: nothing states ${literal}`);
};

/**
 * The verified date of the page these two date-drift fixtures use. Read from the
 * registry rather than pinned: a hard-coded date turns every re-verification
 * round into a false fixture failure, and the registry is what both gates
 * compare the page against in the first place.
 */
const BANKING_VERIFIED = readFileSync(join(SRC, 'data/orientation-pages.mjs'), 'utf8')
  .match(/'src\/pages\/banking\.astro'[^}]*lastVerified: '([0-9-]+)'/)?.[1];
if (!BANKING_VERIFIED) throw new Error('fixture drift: no lastVerified for banking in the registry');

// ---- Input floors: a gate fed a near-empty tree must fail, not pass ----------
// One representative case per input type; every gate carries the same guard.
const emptyDist = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory() && name !== 'eu-citizens') rmSync(p, { recursive: true, force: true });
  }
};

const HOME = 'index.html';
const GUIDE = 'eu-citizens/residency/codice-fiscale/index.html';
const ORIENT = 'banking/index.html';

// Each case: inject one fault, expect the gate to report `expect`.
const seoCases = [
  {
    name: 'dist nearly empty (input floor)',
    expect: 'dist/ is empty or wrong',
    break: emptyDist,
  },
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
    name: 'title longer than a result snippet',
    // 61 characters — one past the limit, so the boundary itself is asserted.
    expect: 'title is 61 chars (max 60)',
    break: (d) =>
      write(
        d,
        ORIENT,
        read(d, ORIENT).replace(
          /<title>[\s\S]*?<\/title>/,
          '<title>Everything you ever wanted to know about Italian retail banks</title>',
        ),
      ),
  },
  {
    name: 'two indexable pages share a title',
    expect: 'indexable pages share the title',
    // Give the guide the orientation page's title, so the pair collides while
    // both stay self-canonical and indexable.
    break: (d) => {
      const title = read(d, ORIENT).match(/<title>([\s\S]*?)<\/title>/)[1];
      write(d, GUIDE, read(d, GUIDE).replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`));
    },
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
    name: 'two elements share an id',
    expect: 'duplicate id(s)',
    // Two glossary entries once shared a slug, so /glossary#conto-di-base was
    // ambiguous and the chips deep-linking to it could not say which definition
    // they meant. axe retired its duplicate-id rule for non-ARIA ids, so nothing
    // was looking.
    break: (d) => {
      const s = read(d, ORIENT);
      const m = s.match(/ id="([^"]+)"/);
      write(d, ORIENT, s.replace('</main>', `<span id="${m[1]}"></span></main>`));
    },
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
    break: (d) => patch(d, ORIENT, `"dateModified":"${BANKING_VERIFIED}"`, '"dateModified":"2020-01-01"'),
  },
  {
    name: 'guide loses its HowTo schema (JSON-LD still parses)',
    expect: 'JSON-LD does not parse',
    break: (d) => patch(d, GUIDE, '"@graph"', '"@graph"broken'),
  },
  {
    name: 'meta description runs past the snippet',
    // 161 characters — one past the limit, so the boundary itself is asserted.
    expect: 'meta description is 161 chars (want 70-160)',
    break: (d) => setDescription(d, ORIENT, 'x'.repeat(161)),
  },
  {
    name: 'meta description too thin to say what the page is',
    expect: 'meta description is 69 chars (want 70-160)',
    break: (d) => setDescription(d, ORIENT, 'y'.repeat(69)),
  },
  {
    name: 'og:description drifts from the meta description',
    expect: 'og:description differs from meta description',
    break: (d) =>
      patch(d, GUIDE, '<meta property="og:description" content="', '<meta property="og:description" content="Something else. '),
  },
  {
    name: 'twitter:description drifts from the meta description',
    expect: 'twitter:description differs from meta description',
    break: (d) =>
      patch(d, GUIDE, '<meta name="twitter:description" content="', '<meta name="twitter:description" content="Something else. '),
  },
  {
    name: 'indexable page loses the EU snippet opt-in',
    expect: 'robots meta missing max-snippet:-1',
    break: (d) => patch(d, ORIENT, ', max-snippet:-1', ''),
  },
  {
    name: 'indexable page loses the large-image opt-in',
    expect: 'robots meta missing max-image-preview:large',
    break: (d) => patch(d, GUIDE, 'max-image-preview:large, ', ''),
  },
  {
    name: 'noindex page stops saying follow',
    expect: 'noindex page does not say follow',
    break: (d) => patch(d, 'search/index.html', 'content="noindex, follow"', 'content="noindex"'),
  },
  {
    name: 'JSON-LD split back into two blocks',
    expect: 'JSON-LD blocks (want 1 holding a single @graph)',
    break: (d) => {
      const s = read(d, GUIDE);
      const tag = s.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/)[0];
      write(d, GUIDE, s.replace(tag, tag + tag));
    },
  },
  {
    name: 'a graph node ships with no @id',
    expect: 'has no @id',
    break: (d) => patch(d, GUIDE, '"@type":"HowTo","@id":', '"@type":"HowTo","@notid":'),
  },
  {
    name: 'an @id pointer resolves to no node',
    expect: '@id reference resolves to no node',
    break: (d) => patch(d, GUIDE, '#howto"', '#nowhere"'),
  },
  {
    name: 'two graph nodes claim the same @id',
    expect: 'duplicate JSON-LD @id',
    // Point the FAQPage at the HowTo's id, so the collision is real rather than
    // just a different string.
    break: (d) => patch(d, GUIDE, '#faq"', '#howto"'),
  },
  {
    name: 'sitemap advertises a page that was not built',
    expect: 'in sitemap but no page built',
    break: (d) =>
      patch(d, 'sitemap-0.xml', '<url><loc>https://www.trasferirsiinitalia.com/banking</loc>', '<url><loc>https://www.trasferirsiinitalia.com/ghost-page</loc>'),
  },
  {
    name: 'sitemap <lastmod> drifts from the date the page states',
    expect: '!= the date the page states',
    break: (d) =>
      patch(
        d,
        'sitemap-0.xml',
        '<url><loc>https://www.trasferirsiinitalia.com/eu-citizens/residency/codice-fiscale</loc><lastmod>',
        '<url><loc>https://www.trasferirsiinitalia.com/eu-citizens/residency/codice-fiscale</loc><lastmod>2019-05-05T00:00:00.000Z</lastmod><ignored>',
      ),
  },
  {
    name: 'a dated page goes into the sitemap with no <lastmod>',
    expect: 'the sitemap gives it no <lastmod>',
    break: (d) => {
      const s = read(d, 'sitemap-0.xml');
      const loc = '<url><loc>https://www.trasferirsiinitalia.com/eu-citizens/residency/codice-fiscale</loc>';
      const entry = s.slice(s.indexOf(loc)).match(/^[\s\S]*?<\/url>/)[0];
      write(d, 'sitemap-0.xml', s.replace(entry, entry.replace(/<lastmod>[^<]*<\/lastmod>/, '')));
    },
  },
  {
    name: 'a cited source is missing from the /sources index',
    expect: '/sources: does not list',
    break: (d) => {
      const href = 'https://www.agenziaentrate.gov.it/portale/prenota-un-appuntamento';
      const s = read(d, 'sources/index.html');
      if (!s.includes(href)) throw new Error('fixture drift: /sources does not list the appointment page');
      write(d, 'sources/index.html', s.replaceAll(href, 'https://example.com/removed'));
    },
  },
  {
    name: 'the data-sources hook disappears, so the scan would cover nothing',
    expect: 'the hook this scan anchors on has gone',
    break: (d) => {
      const walk = (dir) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walk(p);
          else if (name.endsWith('.html')) {
            const s = readFileSync(p, 'utf8');
            if (!s.includes(' data-sources>')) continue;
            writeFileSync(p, s.replaceAll(' data-sources>', '>'));
          }
        }
      };
      walk(d);
    },
  },
  {
    name: 'llms.txt points at a page that does not exist',
    expect: '/llms.txt: links to nothing',
    break: (d) => patch(d, 'llms.txt', '/eu-citizens/residency/codice-fiscale)', '/eu-citizens/residency/ghost)'),
  },
  {
    name: 'llms.txt drops an orientation page',
    expect: '/llms.txt: does not list /banking',
    break: (d) =>
      write(
        d,
        'llms.txt',
        read(d, 'llms.txt')
          .split('\n')
          .filter((l) => !l.includes('/banking)'))
          .join('\n'),
      ),
  },
  {
    name: 'the RSS feed stops stating its own address',
    expect: 'no <atom:link rel="self">',
    break: (d) => patch(d, 'updates.xml', 'rel="self"', 'rel="alternate"'),
  },
  {
    name: 'an undated hub page claims a <lastmod>',
    expect: 'but the page states no verification date',
    break: (d) =>
      patch(
        d,
        'sitemap-0.xml',
        '<url><loc>https://www.trasferirsiinitalia.com/glossary</loc>',
        '<url><loc>https://www.trasferirsiinitalia.com/glossary</loc><lastmod>2026-01-01T00:00:00.000Z</lastmod>',
      ),
  },
];

// ---- Freshness gate: same idea, but its input is src/ rather than dist/ ------
// This is the gate whose completeness scan once passed while checking nothing,
// so it is the one that most needs proving.
const MD = 'src/content/guides/codice-fiscale.md';
const REGISTRY = 'src/data/orientation-pages.mjs';
const PAGE = 'src/pages/banking.astro';
const COUNTRIES = 'src/data/source-countries.mjs';

const freshnessCases = [
  {
    name: 'content tree emptied (input floor)',
    expect: 'wrong or empty root',
    break: (d) => rmSync(join(d, 'src/content'), { recursive: true, force: true }),
  },
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
    break: (d) => patch(d, PAGE, `<time datetime="${BANKING_VERIFIED}"`, '<time datetime="2019-05-05"'),
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
  {
    name: 'source-country note points at a module that does not exist',
    expect: 'note attached to a module that does not exist',
    break: (d) => patch(d, COUNTRIES, "module: '/driving'", "module: '/no-such-module'"),
  },
  {
    name: 'source-country note loses its sources',
    expect: 'note has no sources',
    break: (d) =>
      write(
        d,
        COUNTRIES,
        read(d, COUNTRIES).replace(
          /sources: \[\n( *\{ title: 'MIT[\s\S]*?)\n *\],/,
          'sources: [],',
        ),
      ),
  },
  {
    name: 'source-country note has a future verification date',
    expect: '`lastVerified` is in the future',
    break: (d) => patch(d, COUNTRIES, "lastVerified: '2026-07-24'", "lastVerified: '2099-01-01'"),
  },
  {
    name: 'source-country note loses its Italian text',
    expect: 'note is missing `it`',
    break: (d) => {
      const s = read(d, COUNTRIES);
      write(d, COUNTRIES, s.replace(/\n *it: "L'Italia non ha un accordo[\s\S]*?",/, '\n        it: "",'));
    },
  },
];


// ---- Journey gate: reachability and dead ends, over dist/ ---------------------
const journeyCases = [
  {
    name: 'a page becomes an orphan (nothing links to it)',
    expect: 'not reachable from / by following links',
    // Rewrite every inbound body link across the tree rather than naming the
    // pages: an enumerated list silently under-injects the moment a new page
    // links the target, and the case then passes for the wrong reason.
    break: (d) => stripLinks(d, '/pets'),
  },
  {
    name: 'an Italian page is reachable only from the English tree',
    expect: 'a locale asymmetry',
    // Remove the Italian tree's own inbound links, then link the page from an
    // English one, so its only remaining route crosses locales.
    break: (d) => {
      stripLinks(d, '/it/pets', '/pets', 'it');
      const home = read(d, HOME);
      write(d, HOME, home.replace('</main>', '<a href="/it/pets">cross-locale only</a></main>'));
    },
  },
  {
    name: 'a page becomes a dead end (no onward links)',
    expect: 'dead end — no onward links',
    break: (d) => {
      const s = read(d, 'pets/index.html');
      write(d, 'pets/index.html', s.split('<main')[0] + '<main id="main"><h1>Stranded</h1></main>' + s.split('</main>')[1]);
    },
  },
];

// ---- Figures gate: numbers that stopped being true, over src/ ----------------
const figureCases = [
  {
    name: 'prose reverts to a superseded figure',
    expect: 'states a superseded figure for irpef-middle-bracket',
    // The exact shape of the bug this gate was written for: the old IRPEF rate
    // back in a sentence about the bands, in a file that discusses IRPEF.
    break: (d) => patch(d, 'src/content/guides/residenza-fiscale.md', '**33%** from €28,000', '**35%** from €28,000'),
  },
  {
    name: 'an exemption outlives the sentence that earned it',
    expect: 'no longer contains the permitted phrase',
    // Deleting the historical mention must invalidate its exemption, so the
    // allowance cannot drift over to cover a genuine mistake later.
    break: (d) => patch(d, 'src/content/guides/residenza-fiscale.md', 'still say 35%', 'still say the old rate'),
  },
  {
    name: 'the staged registry is the one that is read',
    expect: 'states a superseded figure for staging-probe',
    // Proves the gate loads figures.mjs from its ROOT, not from a path relative
    // to the script. It did the latter until this case was written: content came
    // from the staged copy while the registry came from the real repo, so any
    // future case editing the registry would have passed for the wrong reason.
    break: (d) => {
      const rel = 'src/data/figures.mjs';
      const s = read(d, rel);
      write(
        d,
        rel,
        s.replace(
          'export const figures = [',
          `export const figures = [
  {
    id: 'staging-probe',
    what: 'a value the staged registry retires and the real one does not',
    current: ['codice fiscale'],
    retired: [{ value: 'anagrafe', supersededBy: 'fixture-only entry' }],
    near: /anagrafe/i,
    quoted: [],
    source: { title: 'fixture', url: 'https://example.invalid/', accessed: '2026-01-01' },
  },`,
        ),
      );
    },
  },
  {
    name: 'the current value stops being stated anywhere',
    expect: 'appears nowhere on the site',
    // A blocklist guarding a figure the site no longer mentions is not a gate,
    // it is a leftover. Removing the figure must be a deliberate registry edit.
    // Rewritten everywhere rather than file by file: naming the pages that
    // state it passes for the wrong reason the moment another page does too.
    break: (d) => stripLiteral(d, '33%', 'thirty-three per cent'),
  },
];

// ---- Theme gate: literal colours that cannot follow dark mode, over src/ -----
const themeCases = [
  {
    name: 'a literal colour ships with no dark-mode override',
    expect: 'has no dark-mode override',
    // The exact bug: bg-white/90 matched none of the overridden alpha steps, so
    // the wizard's controls panel stayed white while its text stayed near-white.
    // Anchored on the full class string so the fixture fails loudly rather than
    // silently patching some other card if the panel's markup changes.
    break: (d) =>
      patch(
        d,
        'src/components/StartWizard.astro',
        'not-prose rounded-xl border border-line bg-surface/60',
        'not-prose rounded-xl border border-line bg-white/90',
      ),
  },
  {
    name: 'a dark-mode override outlives the class it covered',
    expect: 'no longer appears in the source',
    // A rule for a class nobody uses reads as coverage while covering nothing.
    break: (d) =>
      patch(
        d,
        'src/styles/global.css',
        '  .bg-amber-50 {',
        '  .bg-slate-900 {\n    background-color: #000;\n  }\n  .bg-amber-50 {',
      ),
  },
  {
    name: 'a utility names a shade the theme never defined',
    expect: 'is not defined in @theme',
    // border-brand-300 was used 30 times with no --color-brand-300: Tailwind
    // emitted no rule, so every one of those hover borders silently did nothing.
    break: (d) => patch(d, 'src/pages/index.astro', 'hover:border-brand-300', 'hover:border-brand-350'),
  },
];

// ---- Prose gate: walls of text, over dist/ -----------------------------------
const proseCases = [
  {
    name: 'a sentence grows past the limit',
    expect: 'sentence of',
    // The shape of the bug: a list of conditions flattened back into one
    // sentence. 60 words of filler is shorter than the 86-word original was.
    break: (d) =>
      patch(
        d,
        GUIDE,
        '<p>',
        '<p>' + 'The codice fiscale is issued free of charge and it is the key to everything else, '.repeat(4) + 'so get it first. ',
      ),
  },
  {
    name: 'a paragraph grows past the limit',
    expect: 'paragraph of',
    break: (d) => {
      const s = read(d, ORIENT);
      const filler = Array.from({ length: 40 }, (_, i) => `word${i} and more text here.`).join(' ');
      write(d, ORIENT, s.replace('</main>', `<p>${filler}</p></main>`));
    },
  },
];


// ---- Twin-parity gate: its input is src/, like check-freshness ---------------
// Each case changes a figure in ONE language only, which is exactly how a
// translation drifts in practice: someone corrects the copy they were reading.
const IT_GUIDE = 'src/content/guides/it/servizio-sanitario.md';
const IT_ORIENT = 'src/pages/it/banking.astro';

const twinCases = [
  {
    name: 'content tree emptied (input floor)',
    expect: 'wrong or empty root',
    break: (d) => {
      for (const kind of ['region-notes', 'comune-notes'])
        rmSync(join(d, 'src/content', kind), { recursive: true, force: true });
    },
  },
  {
    name: 'an amount is corrected in English only',
    expect: 'amount stated in one language and not the other',
    break: (d) => patch(d, IT_GUIDE, '20.658,28', '20.658,29'),
  },
  {
    name: 'a rate is corrected in English only',
    expect: 'percentage stated in one language and not the other',
    break: (d) => patch(d, IT_GUIDE, '7,5%', '7,6%'),
  },
  {
    name: 'a cited article number drifts between the two languages',
    expect: 'article stated in one language and not the other',
    break: (d) => patch(d, IT_ORIENT, 'art. 126-noviesdecies', 'art. 126-decies'),
  },
  {
    name: 'an Italian twin goes missing',
    expect: 'has no Italian twin',
    break: (d) => unlinkSync(join(d, 'src/content/guides/it/codice-fiscale.md')),
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
    label: 'check-journeys',
    input: DIST,
    envVar: 'CHECK_JOURNEYS_DIST',
    arg: (dir) => dir + '/',
    script: JOURNEY_GATE,
    cases: journeyCases,
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
  {
    label: 'check-figures',
    input: SRC,
    envVar: 'CHECK_FIGURES_ROOT',
    arg: (dir) => dir,
    script: FIGURES_GATE,
    into: 'src',
    cases: figureCases,
  },
  {
    label: 'check-theme',
    input: SRC,
    envVar: 'CHECK_THEME_ROOT',
    arg: (dir) => dir,
    script: THEME_GATE,
    into: 'src',
    cases: themeCases,
  },
  {
    label: 'check-twins',
    input: SRC,
    envVar: 'CHECK_TWINS_ROOT',
    arg: (dir) => dir,
    script: TWINS_GATE,
    into: 'src',
    cases: twinCases,
  },
  {
    label: 'check-prose',
    input: DIST,
    envVar: 'CHECK_PROSE_DIST',
    arg: (dir) => dir + '/',
    script: PROSE_GATE,
    cases: proseCases,
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
console.log(
  `\n✓ test-gates: all ${total} gate rules proven to fire ` +
    `(check-seo + check-journeys + check-prose + check-freshness + check-figures + check-theme + check-twins).`,
);
