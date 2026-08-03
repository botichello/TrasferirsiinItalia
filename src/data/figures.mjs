/**
 * Figures that expire: statutory amounts and rates the site states in prose.
 *
 * Why this registry exists. Every other gate checks *structure* — a page has a
 * canonical, a source, a date, a route in. None of them can tell that a number
 * in a sentence stopped being true. In August 2026 the tax-residency guide was
 * re-verified in July and still said the middle IRPEF bracket was 35%; it had
 * been 33% since 1 January 2026 (L. 199/2025, art. 1, comma 3). The same figure
 * was stated in four places — the EN guide, the IT guide, and both glossary
 * strings — so fixing the one you happened to read would have left three.
 *
 * The mechanism is deliberately narrow and mechanical: record the value that is
 * *no longer true* and the build refuses to contain it. Correcting a figure now
 * means retiring the old one here, which is what makes the other three copies
 * fail loudly instead of ageing quietly.
 *
 * Each entry:
 *   id        stable name, used in gate output
 *   what      the quantity, in words
 *   current   literals that express the value in force (≥1 must appear on the
 *             site — a figure nothing states is a registry entry to delete)
 *   retired   literals that must appear nowhere, each with the act that
 *             superseded it
 *   near      only files matching this are scanned, so a bare "35" elsewhere
 *             (an article number, a phone number, a fine) is not a false alarm
 *   quoted    exact phrases permitted to contain a retired literal — prose that
 *             names the old value on purpose ("was 35% through 2025", "the
 *             Revenue Agency still prints €100,000"). Scoped to a phrase rather
 *             than a file so the rest of the same page stays guarded, and the
 *             phrase must still exist: delete the sentence and the exemption
 *             fails, instead of quietly widening
 *   source    the primary text the current value was read in
 */
export const figures = [
  {
    id: 'irpef-middle-bracket',
    what: 'IRPEF rate on the €28,000–50,000 band',
    current: ['33%', '33 per cento'],
    retired: [
      {
        value: '35%',
        supersededBy: 'L. 30 dicembre 2025, n. 199, art. 1, comma 3 — 35% → 33% in force from 1 January 2026',
      },
      {
        value: '35 per cento',
        supersededBy: 'L. 30 dicembre 2025, n. 199, art. 1, comma 3 — in force from 1 January 2026',
      },
    ],
    near: /irpef|imposta sul reddito|personal income tax|scaglion|aliquot/i,
    quoted: [
      {
        file: 'src/content/guides/residenza-fiscale.md',
        phrase: '**35% through 2025**',
        reason: 'states the superseded rate as history, next to the act that changed it',
      },
      {
        file: 'src/content/guides/residenza-fiscale.md',
        phrase: 'still say 35%',
        reason: 'warns the reader that older guidance carries the old rate',
      },
      {
        file: 'src/content/guides/it/residenza-fiscale.md',
        phrase: '**35% fino al 2025**',
        reason: 'as its English twin',
      },
      {
        file: 'src/content/guides/it/residenza-fiscale.md',
        phrase: 'riportano ancora il 35%',
        reason: 'as its English twin',
      },
    ],
    source: {
      title: 'Normattiva — TUIR art. 11, comma 1 (testo vigente)',
      url: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.del.presidente.della.repubblica:1986-12-22;917~art11!vig=',
      accessed: '2026-08-03',
    },
  },
  {
    id: 'neo-residenti-flat-tax',
    what: 'annual flat substitute tax on foreign income, new-residents regime (TUIR art. 24-bis, comma 2)',
    current: ['€300,000', '300.000 €'],
    retired: [
      {
        value: '€200,000',
        supersededBy: 'L. 30 dicembre 2025, n. 199, art. 1, comma 25 — €200,000 → €300,000, for residence transferred from the law\'s entry into force (comma 26)',
      },
      {
        value: '200.000 €',
        supersededBy: 'L. 30 dicembre 2025, n. 199, art. 1, comma 25',
      },
      {
        value: '€100,000',
        supersededBy: 'raised twice since the regime was introduced; €300,000 in the text in force (TUIR art. 24-bis, comma 2)',
      },
      {
        value: '100.000 €',
        supersededBy: 'raised twice since the regime was introduced; 300.000 € nel testo vigente (TUIR art. 24-bis, comma 2)',
      },
    ],
    near: /neo-residenti|nuovi residenti|new-residents|24-bis/i,
    quoted: [
      // These pages exist partly to say that the Revenue Agency's own English
      // pages still print €100,000. Naming the stale figure is the point.
      {
        file: 'src/pages/from/united-states/taxes.astro',
        phrase: 'figure as €100,000',
        reason: 'quotes the stale amount to warn that an official page still shows it',
      },
      {
        file: 'src/pages/it/from/united-states/taxes.astro',
        phrase: 'ancora 100.000 €',
        reason: 'as its English twin',
      },
    ],
    source: {
      title: 'Normattiva — TUIR art. 24-bis, comma 2 (testo vigente)',
      url: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.del.presidente.della.repubblica:1986-12-22;917~art24bis!vig=',
      accessed: '2026-08-03',
    },
  },
];
