#!/usr/bin/env node
/**
 * Prose gate: is it still readable?
 *
 * The site's value depends on a stressed newcomer being able to act on a page.
 * Every other gate checks whether the page is correct, dated, sourced, reachable
 * and legible; none of them notices when a correct sentence has grown to
 * eighty-six words and stopped being usable.
 *
 * The thresholds are taken from the site's own distribution rather than from
 * taste. Measured across 34,000 paragraphs and 58,000 sentences, the median
 * paragraph is 28 words and the median sentence 15 — the writing is fine. It was
 * the tail that failed: a 148-word paragraph and an 86-word sentence on the
 * citizenship page, which is the page a reader is on while working out whether
 * they qualify for anything at all. Every one of those outliers turned out to be
 * the same defect — a list flattened into prose — and every fix was to unflatten
 * it, which is why the limits below are set where they are:
 *
 *   paragraph ≤ 100 words   — roughly 2.5 phone screens at 390px
 *   sentence  ≤ 55 words    — just above the p99; past it, structure is missing
 *
 * They are deliberately loose. The point is not a house style imposed on 34,000
 * paragraphs, it is that nothing silently becomes a wall of text.
 *
 * List items are measured too, and that is not a detail. The prescribed fix for
 * an over-long paragraph here is to unflatten it into a list — so a gate that
 * reads only <p> hands you an escape hatch and calls it a remedy. It scanned
 * 41,000 paragraphs while 70,000 list items went unread, and eight sentences
 * were sitting in them over the limit, on the city pages that are this site's
 * best-performing search cluster.
 *
 * Two scoping rules keep that honest. Lists marked `not-prose` are skipped:
 * /sources renders its "cited by" enumeration as one comma-separated run, which
 * is a machine-generated index, not writing. And block-level content nested
 * inside an <li> — a <p>, a heading, a sub-list — is removed before measuring,
 * because the <p> scan already covers it and joining a card's heading to its
 * body invented a 58-word sentence that nobody wrote.
 *
 * Usage: node scripts/check-prose.mjs   (needs a completed build in dist/)
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = process.env.CHECK_PROSE_DIST ?? fileURLToPath(new URL('../dist/', import.meta.url));
const MAX_PARAGRAPH = 100;
const MAX_SENTENCE = 55;

if (!existsSync(DIST)) {
  console.error('check-prose: dist/ not found — run the build first.');
  process.exit(1);
}

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return htmlFiles(p);
    if (/^google[0-9a-f]+\.html$/.test(name)) return [];
    return name.endsWith('.html') ? [p] : [];
  });
}

/** Visible text of a fragment: tags out, the common entities back. */
const text = (s) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8217;|&rsquo;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const words = (s) => s.split(' ').filter(Boolean).length;

/**
 * Split on sentence-final punctuation followed by a capital. Abbreviations
 * ("art. 2", "D.lgs", "n. 117") are the reason the lookahead requires a capital
 * or an opening quote: splitting on every period would report nonsense lengths
 * on exactly the legal prose this site is made of.
 */
const sentences = (s) => s.split(/(?<=[.!?:])\s+(?=[A-Z«"(À-ÖØ-Þ])/);

/** An <li>'s own text: nested blocks belong to their own scan, not this one. */
const ownText = (li) => text(li.replace(/<(ul|ol|p|div|h[1-6])[^>]*>[\s\S]*?<\/\1>/g, ' '));

// Same text appears on up to 97 city pages; report it once, with the count.
const longParas = new Map();
const longSents = new Map();

let paraCount = 0;
let sentCount = 0;
let itemCount = 0;

for (const file of htmlFiles(DIST)) {
  const html = readFileSync(file, 'utf8');
  if (!html.includes('<main')) continue;
  const main = html.split('<main')[1].split('</main>')[0];
  const url = '/' + relative(DIST, file).replace(/index\.html$/, '').replace(/\/+$/, '');
  for (const [, inner] of main.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const t = text(inner);
    if (!t) continue;
    paraCount++;
    const pw = words(t);
    if (pw > MAX_PARAGRAPH) {
      const k = t.slice(0, 90);
      if (!longParas.has(k)) longParas.set(k, { words: pw, text: t, pages: new Set() });
      longParas.get(k).pages.add(url);
    }
    for (const raw of sentences(t)) {
      const sw = words(raw);
      if (sw < 2) continue;
      sentCount++;
      if (sw > MAX_SENTENCE) {
        const k = raw.slice(0, 90);
        if (!longSents.has(k)) longSents.set(k, { words: sw, text: raw.trim(), pages: new Set() });
        longSents.get(k).pages.add(url);
      }
    }
  }

  for (const list of main.matchAll(/<(ul|ol)([^>]*)>([\s\S]*?)<\/\1>/g)) {
    if (/not-prose/.test(list[2])) continue;
    for (const [, li] of list[3].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
      const t = ownText(li);
      if (!t) continue;
      itemCount++;
      const iw = words(t);
      if (iw > MAX_PARAGRAPH) {
        const k = t.slice(0, 90);
        if (!longParas.has(k)) longParas.set(k, { words: iw, text: t, pages: new Set() });
        longParas.get(k).pages.add(url);
      }
      for (const raw of sentences(t)) {
        const sw = words(raw);
        if (sw < 2) continue;
        sentCount++;
        if (sw > MAX_SENTENCE) {
          const k = raw.slice(0, 90);
          if (!longSents.has(k)) longSents.set(k, { words: sw, text: raw.trim(), pages: new Set() });
          longSents.get(k).pages.add(url);
        }
      }
    }
  }
}

// Floor: the site has ~34,000 paragraphs. Scanning a few hundred means the
// input is not the built site, and a pass would be meaningless.
if (paraCount < 5000) {
  console.error(`✗ check-prose: only ${paraCount} paragraph(s) found under ${DIST} — dist/ is empty or wrong.`);
  process.exit(1);
}
// The list scan needs its own floor: paragraphs alone passing tells you nothing
// about whether 70,000 list items were read or the selector quietly stopped
// matching, which is the failure this gate was extended to close.
if (itemCount < 10000) {
  console.error(`✗ check-prose: only ${itemCount} list item(s) found under ${DIST} — the list scan is matching nothing.`);
  process.exit(1);
}

const report = (label, map, limit) =>
  [...map.values()]
    .sort((a, b) => b.words - a.words)
    .map(
      (x) =>
        `${label} of ${x.words} words (limit ${limit}), on ${x.pages.size} page(s) — ` +
        `${[...x.pages][0]}\n      "${x.text.slice(0, 120)}…"`,
    );

const errors = [...report('paragraph', longParas, MAX_PARAGRAPH), ...report('sentence', longSents, MAX_SENTENCE)];

if (errors.length > 0) {
  console.error(`\n✗ check-prose: ${errors.length} passage(s) over the limit:\n`);
  console.error(errors.map((e) => `  ${e}`).join('\n'));
  console.error(
    '\n  Almost always the fix is to unflatten a list: if the sentence enumerates\n' +
      '  conditions or options, make it a <ul>. Splitting a paragraph in two is the\n' +
      '  other half of it. Do not pad the limits — they sit above the p99 already.\n',
  );
  process.exit(1);
}
console.log(
  `✓ check-prose: ${paraCount} paragraphs and ${itemCount} list items (≤${MAX_PARAGRAPH} words) ` +
    `and ${sentCount} sentences ` +
    `(≤${MAX_SENTENCE} words) across the built site.`,
);
