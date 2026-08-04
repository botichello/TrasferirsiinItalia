#!/usr/bin/env node
/**
 * Theme gate: a literal colour cannot know about dark mode.
 *
 * The palette lives in custom properties, so `text-muted` or `bg-surface/60`
 * flip automatically under `prefers-color-scheme`. A *literal* utility —
 * `bg-white/90`, `text-amber-800` — does not: it needs an explicit override
 * inside the dark block of global.css, and if nobody writes one it ships as a
 * light-mode colour on a near-black page.
 *
 * That is exactly how the start wizard shipped broken. The dark block
 * overrode `.bg-white/60`, `.bg-white/70` and `.bg-white`; the wizard's sticky
 * controls used `bg-white/90`, which matched none of them, so the panel stayed
 * 90% white while its text stayed near-white ink — 1.01:1, a white panel with
 * white text, on the page whose whole job is to orient a new reader.
 *
 * So: every literal colour utility in the source must either be overridden in
 * the dark block, or allowlisted here with a reason. Preferring a semantic
 * token is the third and best option, which is why the allowlist is short.
 *
 * The gate also checks the other direction — that a *token* utility names a
 * token that exists. `border-brand-300` was used 30 times and never defined, so
 * Tailwind emitted no rule for it and every one of those hover borders did
 * nothing. A dead class is invisible: it does not error, it just quietly has no
 * effect, which is the same false comfort as a gate that stopped firing.
 *
 * Usage: node scripts/check-theme.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.CHECK_THEME_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const CSS = join(SRC, 'styles/global.css');

/**
 * Literals that are correct without a dark-mode override, each with the reason.
 * Keep this short: the fix is almost always a semantic token.
 */
const ALLOWED = new Map([
  [
    'bg-white/20',
    'a lightener painted on top of a brand fill (JourneyNav active step), not a surface — it reads the same in both themes because its parent is dark in both',
  ],
]);

const PALETTE =
  'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const LITERAL = new RegExp(
  `\\b(?:bg|text|border|ring|divide|from|to|via|decoration|outline|shadow|accent|caret|fill|stroke|placeholder)-(?:${PALETTE})(?:-[0-9]{2,3})?(?:/[0-9]{1,3})?\\b`,
  'g',
);
const SCANNED = /\.(astro|ts|tsx|mjs|md)$/;

const errors = [];

function textFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return textFiles(p);
    return SCANNED.test(name) ? [p] : [];
  });
}

// ---- 1. What does the dark block actually override? --------------------------
const css = readFileSync(CSS, 'utf8');
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
if (darkStart === -1) {
  console.error('✗ check-theme: global.css has no prefers-color-scheme: dark block.');
  process.exit(1);
}
// Walk braces from the @media to its matching close, so the block's extent is
// read rather than guessed at with a regex.
let depth = 0;
let darkEnd = darkStart;
for (let i = css.indexOf('{', darkStart); i < css.length; i++) {
  if (css[i] === '{') depth++;
  else if (css[i] === '}' && --depth === 0) {
    darkEnd = i;
    break;
  }
}
const darkBlock = css.slice(darkStart, darkEnd);
// Selectors are written as escaped class names: `.bg-white\/60`, `.text-amber-800`.
const overridden = new Set(
  [...darkBlock.matchAll(/\.([a-z][a-z0-9-]*(?:\\\/[0-9]{1,3})?)\s*[,{]/g)].map(([, cls]) =>
    cls.replace('\\/', '/'),
  ),
);

// ---- 2. Every literal in the source must be overridden or allowlisted --------
const files = textFiles(SRC).map((p) => relative(ROOT, p).split('\\').join('/'));
let literals = 0;
for (const rel of files) {
  if (rel === 'src/styles/global.css') continue;
  const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const util of line.match(LITERAL) ?? []) {
      literals++;
      if (overridden.has(util) || ALLOWED.has(util)) continue;
      errors.push(
        `${rel}:${i + 1} uses the literal colour "${util}", which has no dark-mode override ` +
          `and is not allowlisted.\n` +
          `      Prefer a semantic token (bg-surface, text-link, bg-fill/text-onfill, text-muted),\n` +
          `      or override .${util.replace('/', '\\/')} in the dark block of src/styles/global.css.`,
      );
    }
  });
}

// ---- 3. No override may guard a utility nobody uses -------------------------
// A dark rule for a class the source dropped is dead weight that reads as
// coverage — the same false comfort every other gate here exists to prevent.
const used = new Set();
for (const rel of files) {
  for (const util of readFileSync(join(ROOT, rel), 'utf8').match(LITERAL) ?? []) used.add(util);
}
for (const util of overridden) {
  if (!used.has(util))
    errors.push(
      `src/styles/global.css: the dark block overrides .${util.replace('/', '\\/')}, ` +
        `which no longer appears in the source — remove the rule.`,
    );
}

// ---- 4. Token utilities must name a token that exists -----------------------
// Tailwind emits nothing for an undefined shade, so the class is simply inert.
const defined = new Set(
  [...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map(([, name]) => name),
);
const TOKEN_UTIL = new RegExp(
  `\\b(?:bg|text|border|ring|divide|from|to|via|decoration|outline|shadow|accent|caret|fill|stroke|placeholder)-(${[...defined]
    .map((n) => n.split('-')[0])
    .filter((n, i, a) => a.indexOf(n) === i)
    .join('|')})((?:-[a-z0-9]+)*)(?:/[0-9]{1,3})?\\b`,
  'g',
);
for (const rel of files) {
  if (rel === 'src/styles/global.css') continue;
  readFileSync(join(ROOT, rel), 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const [, base, rest] of line.matchAll(TOKEN_UTIL)) {
        const token = base + (rest ?? '');
        if (defined.has(token)) continue;
        errors.push(
          `${rel}:${i + 1} uses "${token}", which is not defined in @theme — ` +
            `Tailwind emits no rule for it, so the class does nothing.\n` +
            `      Define --color-${token} (both themes) or use a shade that exists.`,
        );
      }
    });
}

if (errors.length > 0) {
  console.error(`\n✗ check-theme: ${errors.length} problem(s):\n`);
  console.error(errors.map((e) => `  ${e}`).join('\n'));
  process.exit(1);
}
console.log(
  `✓ check-theme: ${literals} literal colour use(s) across ${files.length} files — ` +
    `${overridden.size} overridden in the dark block, ${ALLOWED.size} allowlisted, none unhandled; ` +
    `${defined.size} tokens defined, every token utility resolves.`,
);
