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
  {
    console.log('axe (WCAG 2.1 A/AA)');
    const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
    const page = await (await browser.newContext()).newPage();
    for (const path of [
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
    ]) {
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
} finally {
  await browser.close();
  server.kill();
}

if (failures > 0) {
  console.error(`\n✗ smoke: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\n✓ smoke: all checks passed');
