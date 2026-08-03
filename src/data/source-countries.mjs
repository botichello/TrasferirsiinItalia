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
        module: 'residenza-fiscale',
        headingEn: 'The US taxes you wherever you live',
        headingIt: 'Gli USA ti tassano dovunque tu viva',
        en: 'Citizenship-based taxation does not pause when you move: US citizens and green-card holders file on worldwide income regardless of residence, and the filing threshold is measured on gross income before any exclusion. Add FBAR at $10,000 aggregate and Form 8938 at $200,000 for single filers abroad — both independent of how much tax you owe. The treaty prevents double taxation by ordering credits, not by exempting Americans.',
        it: "La tassazione basata sulla cittadinanza non si sospende quando ti trasferisci: cittadini statunitensi e titolari di green card dichiarano il reddito mondiale a prescindere dalla residenza, e la soglia si misura sul reddito lordo prima di ogni esclusione. Aggiungi l'FBAR sopra 10.000 $ complessivi e il Form 8938 sopra 200.000 $ per i single residenti all'estero — entrambi indipendenti da quanto devi. Il trattato evita la doppia imposizione ordinando i crediti, non esentando gli americani.",
        lastVerified: '2026-08-03',
        sources: [
          { title: 'IRS — Publication 54, Tax Guide for U.S. Citizens and Resident Aliens Abroad', url: 'https://www.irs.gov/pub/irs-pdf/p54.pdf' },
          { title: 'IRS — Comparison of Form 8938 and FBAR requirements', url: 'https://www.irs.gov/businesses/comparison-of-form-8938-and-fbar-requirements' },
          { title: 'US Treasury — US–Italy income tax Convention (saving clause, art. 1(2); relief, art. 23)', url: 'https://home.treasury.gov/system/files/131/Treaty-Italy-8-24-1999.pdf' },
        ],
      },
      {
        module: 'servizio-sanitario',
        headingEn: 'Medicare does not travel, and there is no S1 for Americans',
        headingIt: 'Medicare non viaggia, e per gli americani non esiste l’S1',
        en: 'Medicare will not pay for care outside the US except in three narrow situations that all assume you are in or living in the US, and it never covers prescriptions bought abroad. Americans also have no S1 form — the route by which an EU pensioner exports their home cover to the SSN — so voluntary SSN enrolment or private insurance is a decision to make before departure, not after.',
        it: 'Medicare non paga le cure fuori dagli Stati Uniti salvo tre casi ristretti, che presuppongono tutti che tu sia negli USA o vi risieda, e non copre mai i farmaci acquistati all’estero. Gli americani non hanno nemmeno il modello S1, con cui un pensionato UE esporta la copertura del proprio paese verso il SSN: l’iscrizione volontaria al SSN o un’assicurazione privata è una scelta da fare prima di partire, non dopo.',
        lastVerified: '2026-08-03',
        sources: [
          { title: 'Medicare.gov — Travel outside the U.S.', url: 'https://www.medicare.gov/coverage/travel-outside-the-u.s.' },
          { title: 'SSA — Publication 05-10137, Your Payments While You Are Outside the United States', url: 'https://www.ssa.gov/pubs/EN-05-10137.pdf' },
        ],
      },
      {
        module: 'codice-fiscale',
        headingEn: 'Plan for the codice fiscale on arrival, not before',
        headingIt: 'Il codice fiscale arriva all’arrivo, non prima',
        en: 'The Revenue Agency does allow non-residents to apply through an Italian consulate abroad, but consulates restrict it sharply — Chicago limits it to online procedures or cases where you genuinely cannot appoint a representative, expressly excluding study, property purchase and "stay in Italy". For most people relocating the code is assigned in Italy, by the Sportello Unico or the Questura when the residence permit is issued.',
        it: 'L’Agenzia delle Entrate consente ai non residenti di richiederlo tramite un consolato italiano all’estero, ma i consolati lo limitano molto: Chicago lo riserva alle procedure online o ai casi in cui non puoi davvero nominare un rappresentante, escludendo espressamente studio, acquisto di immobili e "soggiorno in Italia". Per chi si trasferisce, il codice viene attribuito in Italia dallo Sportello Unico o dalla Questura al rilascio del permesso.',
        lastVerified: '2026-07-30',
        sources: [
          { title: 'Agenzia delle Entrate — Tax identification number for foreign citizens', url: 'https://www.agenziaentrate.gov.it/portale/web/english/nse/individuals/tax-identification-number-for-foreign-citizens' },
          { title: 'Consulate General of Italy, Chicago — Codice fiscale (consular route and its limits)', url: 'https://conschicago.esteri.it/en/servizi-consolari-e-visti/servizi-per-il-cittadino-straniero/codice-fiscale/' },
        ],
      },
      {
        module: '/non-eu',
        headingEn: 'Ninety days visa-free is not a way in',
        headingIt: 'I 90 giorni senza visto non sono una via d’ingresso',
        en: 'A US passport allows a 90-day visit, not a move. The residence permit is issued only "for the activities provided for by the entry visa", and the visa itself must be issued by an Italian consulate in your US state of residence before you travel — so a tourist entry cannot be converted into residence from inside Italy. Separately: ETIAS is not in operation, and the Entry/Exit System has recorded entries biometrically since 10 April 2026.',
        it: 'Un passaporto statunitense consente una visita di 90 giorni, non un trasferimento. Il permesso di soggiorno è rilasciato solo "per le attività previste dal visto d’ingresso", e il visto va rilasciato da un consolato italiano nello Stato USA di residenza prima di partire: un ingresso turistico non si converte in residenza dall’Italia. Inoltre: ETIAS non è operativo, e dal 10 aprile 2026 l’Entry/Exit System registra gli ingressi con dati biometrici.',
        lastVerified: '2026-07-30',
        sources: [
          { title: 'Normattiva — D.lgs 286/1998, artt. 4 e 5 (visa issued in the state of residence; permit for the visa’s purpose)', url: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:1998-07-25;286' },
          { title: 'Consulate General of Italy, Chicago — American citizens', url: 'https://conschicago.esteri.it/en/servizi-consolari-e-visti/servizi-per-il-cittadino-straniero/visti/american-citizens/' },
          { title: 'European Commission — ETIAS (not in operation)', url: 'https://home-affairs.ec.europa.eu/policies/schengen/smart-borders/european-travel-information-authorisation-system_en' },
          { title: 'European Commission — Entry/Exit System (from 10 April 2026)', url: 'https://home-affairs.ec.europa.eu/policies/schengen/smart-borders/entry-exit-system_en' },
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

/**
 * URL for a note's module in a given locale. The `module` field is polymorphic:
 * orientation pages are absolute paths ('/driving'), journey guides are bare
 * slugs ('residenza-fiscale') that live under /eu-citizens/residency/. Naive
 * concatenation produced '/itresidenza-fiscale' until the link gate caught it.
 */
export const moduleUrl = (module, locale = 'en') => {
  const path = module.startsWith('/') ? module : `/eu-citizens/residency/${module}`;
  return locale === 'it' ? `/it${path}` : path;
};

/** The most recent verification date across a country's notes. */
export const latestVerified = (country) =>
  country.notes.map((n) => n.lastVerified).sort().at(-1) ?? '';
