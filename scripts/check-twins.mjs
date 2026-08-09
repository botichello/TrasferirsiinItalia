#!/usr/bin/env node
/**
 * Cross-language figure parity — every page on this site exists twice, and the
 * two copies must state the same numbers.
 *
 * A translation drifts silently. When a statutory amount moves, the English
 * guide gets corrected because that is the one being read at the time, and the
 * Italian one keeps the old figure until somebody happens to look. Nothing
 * fails: both files parse, both carry sources, both pass every other gate, and
 * the site quietly says two different things about the same law depending on
 * which flag you clicked. `check:figures` catches a *retired* value anywhere;
 * this catches a value that exists in one language and not the other, which is
 * the more common shape of the same failure.
 *
 * Three classes of figure are compared, chosen because getting them wrong
 * changes what a reader does: monetary amounts, percentages, and the article
 * numbers of the statutes cited. Bare integers are deliberately not compared —
 * "15 certificate types" versus "15 tipi di certificato" would be noise, and a
 * gate that cries wolf gets switched off.
 *
 * The comparison normalizes locale formatting, which is most of the work:
 * `€20,658.28` and `20.658,28 €` are the same amount, `7.5%` and `7,5%` are the
 * same rate, and a range is written `€100–500` in English but `da 100 a 500 €`
 * in Italian — three spellings that name two numbers each.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.CHECK_TWINS_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const p = (...parts) => join(ROOT, ...parts);

/**
 * Parse a locale-formatted number. The separator that appears last and is
 * followed by one or two digits is the decimal point; every other separator is
 * grouping. That single rule covers `11,600`, `11.600`, `20,658.28`,
 * `20.658,28`, `34.20` and `34,20` without knowing which language wrote them.
 */
function num(raw) {
  const t = raw.trim();
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  const dec = lastComma > lastDot ? ',' : lastDot > lastComma ? '.' : null;
  let cleaned;
  if (dec === null) {
    cleaned = t.replace(/[.,\s]/g, '');
  } else {
    const at = t.lastIndexOf(dec);
    const digitsAfter = t.length - at - 1;
    cleaned =
      digitsAfter <= 2
        ? t.slice(0, at).replace(/[.,\s]/g, '') + '.' + t.slice(at + 1).replace(/[.,\s]/g, '')
        : t.replace(/[.,\s]/g, '');
  }
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

const N = String.raw`[\d.,]*\d`;
const DASH = String.raw`\s?[–—-]\s?`;

// Ranges name two amounts while marking only some of them with a currency, so
// they are matched before the single-amount pattern and both operands kept.
const MONEY_RANGES = [
  new RegExp(String.raw`€\s?(${N})${DASH}€?\s?(${N})`, 'gi'), // €100–500, €76–€176
  new RegExp(String.raw`(${N})${DASH}(${N})\s?(?:€|euro\b)`, 'gi'), // 6–15 €
  // "da X a Y" / "from X to Y" — the currency mark is *required*, on one side or
  // the other. Made optional it swallows "da 0 a 16 anni" and "da 3 a 10
  // giorni", which is how this pattern first reported four amounts that were
  // ages and waiting times.
  new RegExp(String.raw`\bda\s+€\s?(${N})\s+a\s+€?\s?(${N})`, 'gi'),
  new RegExp(String.raw`\bda\s+(${N})\s+a\s+(${N})\s?(?:€|euro\b)`, 'gi'),
  new RegExp(String.raw`\bfrom\s+€\s?(${N})\s+to\s+€?\s?(${N})`, 'gi'),
  new RegExp(String.raw`\bfrom\s+(${N})\s+to\s+(${N})\s?(?:€|euro\b)`, 'gi'),
];
// Note the boundary placement: `€\b` would demand a word character *after*
// the euro sign, which silently defeats every Italian-style suffixed amount.
const MONEY = new RegExp(String.raw`(?:€\s?(${N})|(${N})\s?(?:€|euro\b))`, 'gi');
const PCT = /(\d+(?:[.,]\d+)?)\s?%/g;
// `art. 9`, `artt. 4-5`, `art. 24-bis`, `Article 23(4)`, `articolo 46`.
const ART =
  /\b(?:art(?:t|icolo|icle)?)\.?\s?(\d+[a-z]*(?:-(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies|noviesdecies))*)/gi;

/**
 * Markup sits *inside* the phrases being matched — `da <strong>76 a 176 €` in an
 * .astro page, `da **100** a **500 €**` in markdown — so a range written across
 * a tag boundary would read as two unrelated numbers. Strip the markup before
 * matching rather than trying to write regexes that tolerate it.
 */
const plain = (text) =>
  text
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`]/g, '')
    .replace(/&nbsp;|&#160;/g, ' ');

function figures(raw) {
  const text = plain(raw);
  const money = new Set();
  const pct = new Set();
  const art = new Set();
  for (const re of MONEY_RANGES)
    for (const m of text.matchAll(re))
      for (const g of [m[1], m[2]]) {
        const v = num(g);
        if (v !== null) money.add(v);
      }
  for (const m of text.matchAll(MONEY)) {
    const v = num(m[1] ?? m[2]);
    if (v !== null) money.add(v);
  }
  for (const m of text.matchAll(PCT)) {
    const v = num(m[1]);
    if (v !== null) pct.add(v);
  }
  for (const m of text.matchAll(ART)) art.add(m[1].toLowerCase());
  return { money, pct, art };
}

// Tolerant of a missing directory on purpose: a truncated tree must reach the
// input floor below and be reported as such, not die on ENOENT with a stack
// trace that says nothing about what is wrong.
const walk = (dir) =>
  (existsSync(dir) ? readdirSync(dir) : []).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.md') ? [full] : [];
  });

// ---- Build the list of twin pairs -------------------------------------------
const pairs = [];
for (const name of (existsSync(p('src/content/guides')) ? readdirSync(p('src/content/guides')) : []))
  if (name.endsWith('.md')) pairs.push([`src/content/guides/${name}`, `src/content/guides/it/${name}`]);
for (const kind of ['region-notes', 'comune-notes'])
  for (const file of walk(p('src/content', kind))) {
    const rel = file.slice(ROOT.length).replace(/^\/+/, '');
    if (rel.includes(`${kind}/it/`)) continue;
    pairs.push([rel, rel.replace(`${kind}/`, `${kind}/it/`)]);
  }
const { orientationPages } = await import(pathToFileURL(p('src/data/orientation-pages.mjs')).href);
for (const entry of orientationPages) pairs.push([entry.en, entry.it]);

// A gate fed a shrunken tree must fail rather than report success over nothing.
if (pairs.length < 50) {
  console.error(`✗ check-twins: only ${pairs.length} twin pair(s) found under ${ROOT} — wrong or empty root.`);
  process.exit(1);
}

// ---- Compare ------------------------------------------------------------------
const LABEL = { money: 'amount', pct: 'percentage', art: 'article' };
const fmt = (kind, v) => (kind === 'money' ? `€${v}` : kind === 'pct' ? `${v}%` : `art. ${v}`);

const errors = [];
for (const [en, it] of pairs) {
  if (!existsSync(p(en)) || !existsSync(p(it))) {
    errors.push(`  ${en}: has no Italian twin at ${it}`);
    continue;
  }
  const a = figures(readFileSync(p(en), 'utf8'));
  const b = figures(readFileSync(p(it), 'utf8'));
  for (const kind of ['money', 'pct', 'art']) {
    const onlyEn = [...a[kind]].filter((x) => !b[kind].has(x));
    const onlyIt = [...b[kind]].filter((x) => !a[kind].has(x));
    if (onlyEn.length === 0 && onlyIt.length === 0) continue;
    const parts = [];
    if (onlyEn.length) parts.push(`English only: ${onlyEn.map((v) => fmt(kind, v)).join(', ')}`);
    if (onlyIt.length) parts.push(`Italian only: ${onlyIt.map((v) => fmt(kind, v)).join(', ')}`);
    errors.push(`  ${en}: ${LABEL[kind]} stated in one language and not the other — ${parts.join('; ')}`);
  }
}

if (errors.length > 0) {
  console.error(`✗ check-twins: ${errors.length} divergence(s) across ${pairs.length} twin pairs:\n`);
  console.error(errors.slice(0, 40).join('\n'));
  if (errors.length > 40) console.error(`  … and ${errors.length - 40} more`);
  console.error(
    '\n  Either the translation missed a correction, or one language states a\n' +
      '  figure the other omits. Fix the content — do not relax the comparison.',
  );
  process.exit(1);
}
console.log(`✓ check-twins: ${pairs.length} twin pairs state the same amounts, rates and article numbers.`);
