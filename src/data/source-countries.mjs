/**
 * Source-country layer: what differs for a reader depending on the country they
 * are moving FROM, as opposed to the destination detail the rest of the site
 * organises around (national → region → comune).
 *
 * Deliberately a data layer rather than a page matrix. A per-module overlay for
 * every source country would mean 21 modules × N countries of mostly empty
 * pages — thin near-duplicates of the kind the canonical strategy exists to
 * avoid. Instead a note exists only where there is a verified, country-specific
 * difference; modules opt in with <SourceNote module="/driving" />, and the
 * per-country hub page collects the whole picture in one place.
 *
 * Each note carries its own sources and verification date, so the citability
 * contract applies at note granularity: scripts/check-freshness.mjs validates
 * every entry, and scripts/check-links.mjs checks every source URL.
 *
 * Plain .mjs (types in source-countries.d.ts) so the node build scripts can
 * import it without a TS toolchain — same arrangement as orientation-pages.
 */



export const sourceCountries = [
  {
    slug: 'united-states',
    code: 'US',
    nameEn: 'the United States',
    nameIt: 'gli Stati Uniti',
    fromEn: 'moving from the United States',
    fromIt: 'chi si trasferisce dagli Stati Uniti',
    notes: [
      {
        module: '/driving',
        headingEn: 'Your US licence cannot be converted',
        headingIt: 'La patente statunitense non è convertibile',
        en: 'Italy has no licence-conversion agreement with the United States except for diplomatic and consular staff. After one year of registered residence an American must pass the Italian theory and practical exams — and the theory test is offered only in Italian, German or French, not English. Start early: this is the single most expensive surprise for US movers.',
        it: "L'Italia non ha un accordo di conversione della patente con gli Stati Uniti, salvo per il personale diplomatico e consolare. Dopo un anno di residenza anagrafica un cittadino statunitense deve superare gli esami italiani di teoria e pratica — e la teoria è disponibile solo in italiano, tedesco o francese, non in inglese. Mettiti in moto presto: è la sorpresa più costosa per chi arriva dagli USA.",
        lastVerified: '2026-07-24',
        sources: [
          { title: 'MIT — Conversione patente estera (reciprocity list: USA limited to diplomatic staff)', url: 'https://www.mit.gov.it/conversione-patente-estera' },
          { title: 'MIT — Conseguimento patente B (exams, foglio rosa, costs)', url: 'https://www.mit.gov.it/conseguimento-patente-b' },
        ],
      },
      {
        module: '/pets',
        headingEn: 'No rabies blood test needed',
        headingIt: 'Non serve il test del sangue antirabbico',
        en: 'The United States is on the listed-country annex, so a dog, cat or ferret travelling from the US does not need the rabies antibody titration test. You still need the microchip, a rabies vaccination given at least 21 days before travel, and an animal health certificate issued no more than 10 days before entry.',
        it: 'Gli Stati Uniti figurano nell’allegato dei paesi elencati, quindi un cane, un gatto o un furetto in arrivo dagli USA non ha bisogno della titolazione degli anticorpi antirabbici. Restano necessari il microchip, la vaccinazione antirabbica almeno 21 giorni prima della partenza e un certificato sanitario rilasciato non più di 10 giorni prima dell’ingresso.',
        lastVerified: '2026-07-30',
        sources: [
          { title: 'EUR-Lex — Implementing Regulation (EU) 2026/636, Annex II (listed third countries)', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R0636' },
          { title: 'EUR-Lex — Delegated Regulation (EU) 2026/131, artt. 14, 17-19', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R0131' },
        ],
      },
    ],
  },
];

/** Look a country up by slug. */
export const getSourceCountry = (slug) =>
  sourceCountries.find((c) => c.slug === slug);

/** Every note attached to a module, across all source countries. */
export function notesForModule(module) {
  return sourceCountries.flatMap((country) =>
    country.notes.filter((n) => n.module === module).map((note) => ({ country, note })),
  );
}

/** The most recent verification date across a country's notes. */
export const latestVerified = (country) =>
  country.notes.map((n) => n.lastVerified).sort().at(-1) ?? '';
