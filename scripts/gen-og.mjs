#!/usr/bin/env node
/**
 * Generate the per-guide social cards (public/og/<slug>.png and
 * public/og/it/<slug>.png) plus og-default.png, in the site's visual
 * language: paper background, tricolore spine, Fraunces-style serif title.
 * Uses sharp (already present as Astro's image dependency).
 * Re-run after adding or renaming guides: npm run gen:og
 */
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('sharp');

const ROOT = new URL('..', import.meta.url).pathname;
const GUIDES = join(ROOT, 'src/content/guides');
const SERIF = 'Liberation Serif, DejaVu Serif, serif';
const SANS = 'Liberation Sans, DejaVu Sans, sans-serif';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Greedy word wrap tuned for ~68px serif on a 1010px column. */
function wrap(text, max = 28) {
  const words = text.split(' ');
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (cur && (cur + ' ' + w).length > max) lines.push(w);
    else lines[lines.length - 1] = cur ? `${cur} ${w}` : w;
  }
  return lines;
}

function card({ eyebrow, title, footer }) {
  const lines = wrap(title);
  const size = lines.length > 2 ? 64 : 76;
  const lineHeight = size * 1.15;
  const startY = 300 - ((lines.length - 1) * lineHeight) / 2;
  const tspans = lines
    .map((l, i) => `<tspan x="92" y="${startY + i * lineHeight}">${esc(l)}</tspan>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#fbfaf7"/>
  <rect x="0" y="0" width="14" height="630" fill="#008C45"/>
  <rect x="14" y="0" width="14" height="630" fill="#f4f5f0"/>
  <rect x="28" y="0" width="14" height="630" fill="#CD212A"/>
  <rect x="92" y="520" width="1016" height="2" fill="#e7e3da"/>
  <text x="92" y="150" font-family="${SANS}" font-size="28" font-weight="600" letter-spacing="5" fill="#2f6b4f">${esc(eyebrow.toUpperCase())}</text>
  <text font-family="${SERIF}" font-size="${size}" font-weight="700" fill="#1c1b18">${tspans}</text>
  <text x="92" y="575" font-family="${SERIF}" font-size="32" font-weight="700" fill="#265840">Trasferirsi in Italia</text>
  <text x="1108" y="575" font-family="${SANS}" font-size="28" font-weight="600" fill="#6b675f" text-anchor="end">${esc(footer)}</text>
</svg>`;
}

const fm = (file) => {
  const src = readFileSync(file, 'utf8');
  return {
    title: src.match(/^title:\s*(.+)$/m)?.[1].replace(/^['"]|['"]$/g, ''),
    step: src.match(/^step:\s*(\d+)/m)?.[1],
  };
};

async function render(svg, out) {
  await sharp(Buffer.from(svg), { density: 96 }).png().toFile(out);
}

mkdirSync(join(ROOT, 'public/og/it'), { recursive: true });
let n = 0;
for (const lang of ['en', 'it']) {
  const dir = lang === 'it' ? join(GUIDES, 'it') : GUIDES;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const { title, step } = fm(join(dir, f));
    const slug = f.replace(/\.md$/, '');
    const svg = card({
      eyebrow: lang === 'it' ? `Passo ${step} · Percorso di residenza UE` : `Step ${step} · EU residency journey`,
      title,
      footer: lang === 'it' ? 'verificato · con fonti' : 'verified · sourced',
    });
    await render(svg, join(ROOT, `public/og/${lang === 'it' ? 'it/' : ''}${slug}.png`));
    n++;
  }
}

// Hub pages get cards too, so shared links to the checklist, updates log,
// etc. carry their own title instead of the generic site card.
const HUBS = [
  ['checklist', 'The full journey checklist', 'La checklist completa del percorso'],
  ['updates', 'Updates & verification log', 'Aggiornamenti e registro delle verifiche'],
  ['glossary', 'Glossary of Italian bureaucracy', 'Glossario della burocrazia italiana'],
  ['cities', 'Browse by city', 'Sfoglia per città'],
  ['regions', 'Browse by region', 'Sfoglia per regione'],
  ['start', 'Start here: your personalized path', 'Inizia qui: il tuo percorso personalizzato'],
  ['non-eu', 'Not an EU citizen? Read this first', 'Non sei cittadino UE? Leggi prima questo'],
  ['digital-nomad', "Italy's digital nomad visa", 'Il visto per nomadi digitali'],
  ['elective-residence', "Italy's elective residence visa", 'Il visto per residenza elettiva'],
  ['study-visa', "Italy's student visa", 'Il visto per studio (università)'],
  ['family-reunification', 'Family reunification in Italy', 'Ricongiungimento familiare in Italia'],
  ['long-term-residence', 'The EU long-term residence permit', 'Soggiornanti di lungo periodo UE'],
  ['blue-card', 'The EU Blue Card in Italy', 'La Carta blu UE in Italia'],
  ['citizenship', 'Italian citizenship', 'La cittadinanza italiana'],
  ['renting', 'Renting a home in Italy', 'Affittare casa in Italia'],
  ['schools', 'School: enrolling your children', 'Scuola: iscrivere i figli'],
  ['driving', 'Driving on a foreign licence', 'Guidare con la patente estera'],
  ['banking', 'Opening a bank account', 'Aprire un conto bancario'],
  ['pets', 'Moving with a dog or cat', 'Trasferirsi con cane o gatto'],
  ['from-united-states', 'Moving from the United States', 'Trasferirsi dagli Stati Uniti'],
  ['from-us-arriving', 'Arriving from the United States', 'Arrivare dagli Stati Uniti'],
  ['from-us-taxes', 'US taxes for Americans in Italy', 'Tasse USA per gli americani in Italia'],
];
for (const [name, en, it] of HUBS) {
  for (const [lang, title] of [['en', en], ['it', it]]) {
    await render(
      card({
        eyebrow: lang === 'it' ? 'Trasferirsi in Italia' : 'Moving to Italy, verified',
        title,
        footer: lang === 'it' ? 'verificato · con fonti' : 'verified · sourced',
      }),
      join(ROOT, `public/og/${lang === 'it' ? 'it/' : ''}${name}.png`),
    );
    n++;
  }
}

await render(
  card({
    eyebrow: 'Moving to Italy, verified',
    title: 'Trasferirsi in Italia',
    footer: 'EN · IT',
  }),
  join(ROOT, 'public/og-default.png'),
);

// PWA / manifest icons: the favicon mark at the two required sizes.
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#265840"/>
  <text x="16" y="22" font-family="${SERIF}" font-size="18" font-weight="700" fill="#fbfaf7" text-anchor="middle">It</text>
</svg>`;
for (const size of [192, 512]) {
  await sharp(Buffer.from(iconSvg), { density: 300 }).resize(size, size).png()
    .toFile(join(ROOT, `public/icon-${size}.png`));
}

console.log(`✓ generated ${n} cards + og-default.png + manifest icons`);
