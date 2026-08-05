#!/usr/bin/env node
/**
 * Figures gate: a number that stopped being true must not survive in prose.
 *
 * The other gates check that a page is dated, sourced, canonical and reachable.
 * All four can be perfectly green while a sentence states an amount the statute
 * changed eighteen months ago — which is exactly what happened to the middle
 * IRPEF bracket: 35% in four files, 33% in the law since 1 January 2026, the
 * guide re-verified in July 2026 with the error intact.
 *
 * So `src/data/figures.mjs` records, per figure, the literals that are *no
 * longer true*, and this refuses to build while any of them appears in a file
 * that talks about that figure. Two rules:
 *
 *   1. no retired literal anywhere, except inside an exact phrase the registry
 *      permits with a reason (prose that names the old value on purpose);
 *   2. every permitted phrase still exists — delete the sentence and the
 *      exemption fails instead of quietly widening to cover new mistakes;
 *   3. every registered figure's current value appears at least once — a figure
 *      the site no longer states is a registry entry to delete on purpose,
 *      not one to leave behind guarding nothing.
 *
 * Rules 2 and 3 are what keep this honest. A blocklist alone decays into
 * something vacuous as prose is rewritten around it: exemptions outlive the text
 * that earned them, and the value being guarded stops being stated at all.
 *
 * Usage: node scripts/check-figures.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { figures } from '../src/data/figures.mjs';

const ROOT = process.env.CHECK_FIGURES_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const SCANNED = /\.(md|astro|ts|mjs)$/;
/** The registry states the retired values by definition; scanning it is circular. */
const SKIP = new Set(['src/data/figures.mjs']);

const errors = [];

function textFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return textFiles(p);
    return SCANNED.test(name) ? [p] : [];
  });
}

const files = textFiles(SRC)
  .map((p) => relative(ROOT, p).split('\\').join('/'))
  .filter((rel) => !SKIP.has(rel))
  .sort();

// Floor: src/ carries ~260 scannable files. Near-zero means a wrong root.
if (files.length < 100) {
  console.error(`✗ check-figures: only ${files.length} file(s) found under ${SRC} — wrong root.`);
  process.exit(1);
}

const contents = new Map(files.map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf8')]));

for (const fig of figures) {
  // ---- 1. Retired literals ---------------------------------------------------
  for (const [rel, text] of contents) {
    if (!fig.near.test(text)) continue;
    const exempt = fig.quoted.filter((q) => q.file === rel);
    const lines = text.split('\n');
    for (const { value, supersededBy } of fig.retired) {
      lines.forEach((line, i) => {
        if (!line.includes(value)) return;
        // Permitted only if the occurrence sits inside a phrase the registry
        // names — so the rest of the line, and the rest of the file, stay guarded.
        if (exempt.some((q) => q.phrase.includes(value) && line.includes(q.phrase))) return;
        errors.push(
          `${rel}:${i + 1} states a superseded figure for ${fig.id} — ` +
            `"${value}" is retired; ${fig.what} is ${fig.current[0]}.\n` +
            `      superseded by ${supersededBy}`,
        );
      });
    }
  }

  // ---- 2. Exemptions must still describe text that exists --------------------
  for (const q of fig.quoted) {
    const text = contents.get(q.file);
    if (text === undefined)
      errors.push(`${fig.id}: quoted exemption names ${q.file}, which is not a scanned file.`);
    else if (!text.includes(q.phrase))
      errors.push(
        `${fig.id}: ${q.file} no longer contains the permitted phrase "${q.phrase}" — ` +
          `remove the exemption rather than leaving it to cover something else.`,
      );
  }

  // ---- 3. The current value must be stated somewhere -------------------------
  const stated = [...contents].some(([, text]) => fig.current.some((v) => text.includes(v)));
  if (!stated)
    errors.push(
      `${fig.id}: current value (${fig.current.join(' / ')}) appears nowhere on the site — ` +
        `either the prose drifted, or the figure is no longer stated and the registry entry should be removed.`,
    );
}

if (errors.length > 0) {
  console.error(`\n✗ check-figures: ${errors.length} problem(s):\n`);
  console.error(errors.map((e) => `  ${e}`).join('\n'));
  console.error('\n  Fix the prose, or — if the figure changed again — update src/data/figures.mjs');
  console.error('  against the primary text and retire the value it replaces.\n');
  process.exit(1);
}

const guarded = figures.reduce((n, f) => n + f.retired.length, 0);
const quoted = figures.reduce((n, f) => n + f.quoted.length, 0);
console.log(
  `✓ check-figures: ${figures.length} tracked figure(s), ${guarded} retired value(s) absent ` +
    `from ${files.length} files, all current values stated ` +
    `(${quoted} phrase(s) allowed to quote a stale figure).`,
);
