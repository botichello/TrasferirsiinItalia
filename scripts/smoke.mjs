#!/usr/bin/env node
/**
 * End-to-end smoke tests for the built site: the three JS islands (search,
 * start wizard, document checklist), dark mode, the 404 page, and an axe
 * accessibility scan (WCAG 2.1 A/AA) of representative pages.
 *
 * Runs against dist/ by spawning `astro preview`. Usage:
 *   npm run build && npm run test:smoke
 * Chromium resolution: CHROMIUM_PATH env if set (e.g. a system browser),
 * otherwise Playwright's own browser registry (PLAYWRIGHT_BROWSERS_PATH).
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const PORT = 4322;
const BASE = `http://127.0.0.1:${PORT}`;
let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const fail = (name, detail) => {
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};
const assert = (cond, name, detail) => (cond ? ok(name) : fail(name, detail));

// ---- boot the preview server -------------------------------------------------
const server = spawn('npx', ['astro', 'preview', '--host', '127.0.0.1', '--port', String(PORT)], {
  stdio: 'ignore',
  detached: false,
});
const up = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE + '/');
      if (r.ok) return true;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};
if (!(await up())) {
  console.error('✗ preview server did not come up');
  server.kill();
  process.exit(1);
}

const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath });

try {
  // ---- search island ---------------------------------------------------------
  {
    console.log('search island');
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${BASE}/search?q=Florence`, { waitUntil: 'networkidle' });
    const first = await page.locator('[data-search-results] a').first().textContent();
    assert(first?.includes('Firenze'), 'exonym query "Florence" finds Firenze', `got: ${first}`);
    await page.fill('[data-search-input]', 'sanita');
    const n = await page.locator('[data-search-results] li').count();
    assert(n > 0, 'accent-insensitive "sanita" returns results');
    await page.close();
  }

  // ---- discoverability: origin routes reachable from the homepage -------------
  // The US hub was once reachable only from the footer, among 16 other links.
  // These assert the homepage itself offers the origin axis, in both locales.
  {
    console.log('homepage origin routes');
    const page = await (await browser.newContext()).newPage();
    for (const [home, hub, label] of [
      ['/', '/from/united-states', 'Where are you starting from?'],
      ['/it', '/it/from/united-states', 'Da dove parti?'],
    ]) {
      await page.goto(`${BASE}${home}`, { waitUntil: 'domcontentloaded' });
      assert(
        (await page.locator(`main a[href="${hub}"]`).count()) > 0,
        `${home} links to ${hub} in the page body (not just the footer)`,
      );
      assert(
        await page.getByText(label, { exact: false }).first().isVisible(),
        `${home} shows the "${label}" chooser`,
      );
    }
    await page.close();
  }

  // ---- start wizard island ---------------------------------------------------
  {
    console.log('start wizard');
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${BASE}/start`, { waitUntil: 'networkidle' });
    assert(
      await page.locator('[data-wizard-controls]').isVisible(),
      'controls revealed by JS',
    );
    await page.click('[data-status-btn="student"]');
    const highlighted = await page.locator('.status-row.is-you').count();
    assert(highlighted >= 2, 'picking a situation highlights its rows', `got ${highlighted}`);
    assert(
      (await page.locator('[data-status-btn="pensioner"]').count()) === 1,
      'pensioner situation present',
    );
    // "Beyond the eight steps" cards: highlighted for the situations they bear
    // on, never dimmed (they stay relevant to everyone).
    await page.click('[data-status-btn="family"]');
    assert(
      await page.locator('[data-status-any~="family"].is-you').first().isVisible(),
      'family situation highlights the schools card',
    );
    // Anchored on the population, not just the absence: `count() === 0` alone
    // would also pass if [data-status-any] stopped existing, which is the
    // vacuous shape this suite exists to avoid.
    const anyCards = await page.locator('[data-status-any]').count();
    assert(anyCards >= 5, 'orientation cards present to be judged', `got ${anyCards}`);
    assert(
      (await page.locator('[data-status-any].is-dim').count()) === 0,
      'orientation cards are never dimmed',
    );
    const schools = await page.locator('[data-status-any~="family"] a').first().getAttribute('href');
    assert(schools === '/schools', 'schools card links to the orientation page', `got ${schools}`);
    await page.click('[data-status-btn="student"]');
    await page.selectOption('[data-wizard-city]', 'firenze');
    const href = await page.locator('[data-step-link]').first().getAttribute('href');
    assert(
      href === '/cities/firenze/residency/codice-fiscale',
      'city choice rewrites step links',
      `got ${href}`,
    );
    await page.close();
  }

  // ---- document checklist persistence ------------------------------------------
  {
    console.log('document checklist');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const url = `${BASE}/eu-citizens/residency/codice-fiscale`;
    await page.goto(url, { waitUntil: 'networkidle' });
    const box = page.locator('input[type="checkbox"]').first();
    await box.check();
    await page.goto(url, { waitUntil: 'networkidle' });
    assert(
      await page.locator('input[type="checkbox"]').first().isChecked(),
      'ticked document survives reload (localStorage)',
    );
    const chips = await page.locator('a[href*="/glossary#"]').count();
    assert(chips > 0, 'glossary term chips render on guide pages', `got ${chips}`);
    await page.close();
    await ctx.close();
  }

  // ---- dark mode ---------------------------------------------------------------
  {
    console.log('dark mode');
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert(bg === 'rgb(23, 22, 19)', 'dark paper background applies', `got ${bg}`);
    await page.close();
    await ctx.close();
  }

  // ---- 404 ----------------------------------------------------------------------
  {
    console.log('404');
    const page = await (await browser.newContext()).newPage();
    const resp = await page.goto(`${BASE}/definitely-not-a-page`, { waitUntil: 'networkidle' });
    assert(resp?.status() === 404, 'unknown path returns 404');
    assert(
      (await page.locator('h1').textContent())?.includes('Page not found'),
      'branded 404 page renders',
    );
    await page.close();
  }

  // ---- axe accessibility scan -----------------------------------------------------
  const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const AXE_PAGES = [
    '/',
    '/eu-citizens/residency/codice-fiscale',
    '/cities/firenze/residency/iscrizione-anagrafica',
    '/regions/toscana/residency/servizio-sanitario',
    '/non-eu',
    '/non-eu/digital-nomad',
    '/glossary',
    '/checklist',
    '/updates',
    '/it',
    '/it/checklist',
    '/start',
  ];
  {
    console.log('axe (WCAG 2.1 A/AA)');
    const page = await (await browser.newContext()).newPage();
    for (const path of AXE_PAGES) {
      await page.goto(BASE + path, { waitUntil: 'networkidle' });
      await page.addScriptTag({ content: axeSource });
      const violations = await page.evaluate(async () =>
        (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations,
      );
      assert(
        violations.length === 0,
        `${path} passes`,
        violations.map((v) => `${v.id}(${v.nodes.length})`).join(', '),
      );
    }
    await page.close();
  }

  // One URL per page template, both locales — the widest coverage the browser
  // checks below can afford. Machine checks (canonicals, links, schema) run over
  // all 1607 pages in the build gates; these run over every distinct layout.
  const TEMPLATE_PAGES = [
    '/', '/start', '/checklist', '/glossary', '/updates', '/sources', '/cities', '/regions',
    '/how-we-verify', '/about', '/search?q=Florence', '/definitely-not-a-page',
    '/eu-citizens/residency/codice-fiscale', '/eu-citizens/residency/servizio-sanitario',
    '/cities/firenze/residency/iscrizione-anagrafica',
    '/regions/toscana/residency/servizio-sanitario',
    '/non-eu', '/non-eu/blue-card', '/non-eu/digital-nomad', '/non-eu/elective-residence',
    '/non-eu/family-reunification', '/non-eu/long-term-residence', '/non-eu/study-visa',
    '/from/united-states', '/from/united-states/arriving', '/from/united-states/taxes',
    '/banking', '/citizenship', '/driving', '/pets', '/renting', '/schools',
    '/it', '/it/start', '/it/checklist', '/it/glossary', '/it/updates', '/it/sources',
    '/it/cities', '/it/regions', '/it/how-we-verify', '/it/about', '/it/search?q=Firenze',
    '/it/eu-citizens/residency/codice-fiscale',
    '/it/cities/firenze/residency/iscrizione-anagrafica',
    '/it/regions/toscana/residency/servizio-sanitario',
    '/it/non-eu', '/it/non-eu/digital-nomad', '/it/from/united-states',
    '/it/from/united-states/taxes', '/it/banking', '/it/citizenship', '/it/driving',
    '/it/pets', '/it/renting', '/it/schools',
  ];

  // ---- no horizontal overflow at phone widths -------------------------------------
  // A page wider than the viewport is a bug the reporter's browser decides
  // whether to show: /start overflowed by 23px at 390px and by 93px at 320px,
  // which read as "fine in Chrome, broken in Brave". Two causes, both structural
  // — an unwrapped flex row whose floor was a fixed label column plus a
  // shrink-0 badge, and unbreakable PEC addresses in the comune notes.
  //
  // Asserted at the document level, which is what a reader perceives: content
  // inside a deliberate overflow-x container (the journey nav's step pills) does
  // not widen documentElement.scrollWidth, so it is not a false positive.
  {
    console.log('layout (no horizontal overflow, phone widths)');
    for (const width of [320, 360, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: 800 } });
      const page = await ctx.newPage();
      const bad = [];
      for (const path of TEMPLATE_PAGES) {
        await page.goto(BASE + path, { waitUntil: 'networkidle' });
        if (path.endsWith('/start')) {
          // The "your situation" badge only exists once a situation is picked,
          // and it was part of what made the row overflow.
          await page.click('[data-status-btn="student"]').catch(() => {});
          await page.waitForTimeout(80);
        }
        const over = await page.evaluate(() => {
          const d = document.documentElement;
          return d.scrollWidth - d.clientWidth;
        });
        if (over > 1) bad.push(`${path} +${over}px`);
      }
      assert(bad.length === 0, `${width}px: no page wider than the viewport`, bad.slice(0, 5).join(', '));
      await page.close();
      await ctx.close();
    }
  }

  // ---- contrast, both themes, every template --------------------------------------
  // The scan above runs in the browser default: light, desktop. Dark mode had a
  // single assertion (the body background) and its *contrast* was never measured,
  // which is how the start wizard's sticky controls shipped as a white panel with
  // white text — 1.01:1 — alongside 386 nodes of unreadable link text.
  //
  // One width is enough: no colour utility in the source is breakpoint-qualified
  // (no `sm:text-*` / `md:bg-*`), so a narrow viewport is used because that is
  // where a reader met the bug, not because colour varies with it. Coverage goes
  // wide across templates instead — one URL per page template, both locales.
  {
    console.log('contrast (dark + light, every template)');
    for (const scheme of ['dark', 'light']) {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      const bad = [];
      for (const path of TEMPLATE_PAGES) {
        await page.goto(BASE + path, { waitUntil: 'networkidle' });
        // Exercise the wizard so the highlighted and dimmed rows are measured too:
        // `.is-dim` used to composite its text down to 2.5:1 and no scan saw it.
        if (path.endsWith('/start')) {
          await page.click('[data-status-btn="student"]').catch(() => {});
          await page.waitForTimeout(100);
        }
        await page.addScriptTag({ content: axeSource });
        const violations = await page.evaluate(async () =>
          (await axe.run(document, { runOnly: ['color-contrast'] })).violations,
        );
        for (const v of violations)
          for (const n of v.nodes) {
            const d = n.any?.[0]?.data ?? {};
            bad.push(`${path} ${d.contrastRatio}:1 ${d.fgColor} on ${d.bgColor}`);
          }
      }
      assert(
        bad.length === 0,
        `${scheme}: ${TEMPLATE_PAGES.length} templates pass colour contrast`,
        `${bad.length} node(s) — ${[...new Set(bad)].slice(0, 4).join(' | ')}`,
      );
      await page.close();
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}

if (failures > 0) {
  console.error(`\n✗ smoke: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\n✓ smoke: all checks passed');
