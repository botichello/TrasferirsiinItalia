/**
 * Registry of the orientation pages (src/pages/*.astro outside the content
 * collections) so they get the same freshness discipline as the guides:
 * scripts/check-freshness.mjs fails the build if an entry's reviewBy is not
 * after lastVerified, warns when overdue, verifies both language files exist,
 * checks the page's own <time datetime> matches lastVerified, and catches any
 * unregistered page carrying the orientation sentinel.
 *
 * The titles feed the /updates verification log (src/lib/updates.ts) and the
 * history builder (scripts/build-history.mjs); the page URL is derived from
 * the `en` path (src/pages/schools.astro → /schools).
 *
 * When re-verifying a page: update its on-page date AND this entry.
 * Plain .mjs so the node scripts can import it without a TS toolchain.
 */
export const orientationPages = [
  { en: 'src/pages/non-eu.astro', it: 'src/pages/it/non-eu.astro', lastVerified: '2026-07-20', reviewBy: '2027-01-20', title: 'Not an EU citizen? Read this first', titleIt: 'Non sei cittadino UE? Leggi prima questo' },
  { en: 'src/pages/non-eu/digital-nomad.astro', it: 'src/pages/it/non-eu/digital-nomad.astro', lastVerified: '2026-07-21', reviewBy: '2027-01-21', title: "Italy's digital nomad visa", titleIt: 'Il visto per nomadi digitali' },
  { en: 'src/pages/non-eu/elective-residence.astro', it: 'src/pages/it/non-eu/elective-residence.astro', lastVerified: '2026-07-22', reviewBy: '2027-01-22', title: "Italy's elective residence visa", titleIt: 'Il visto per residenza elettiva' },
  { en: 'src/pages/non-eu/study-visa.astro', it: 'src/pages/it/non-eu/study-visa.astro', lastVerified: '2026-07-22', reviewBy: '2027-01-22', title: "Italy's student visa (university)", titleIt: 'Il visto per studio (università)' },
  { en: 'src/pages/non-eu/family-reunification.astro', it: 'src/pages/it/non-eu/family-reunification.astro', lastVerified: '2026-07-22', reviewBy: '2027-01-22', title: 'Family reunification (non-EU sponsors)', titleIt: 'Ricongiungimento familiare (sponsor non UE)' },
  { en: 'src/pages/non-eu/long-term-residence.astro', it: 'src/pages/it/non-eu/long-term-residence.astro', lastVerified: '2026-07-22', reviewBy: '2027-01-22', title: 'The EU long-term residence permit', titleIt: 'Il permesso UE per soggiornanti di lungo periodo' },
  { en: 'src/pages/non-eu/blue-card.astro', it: 'src/pages/it/non-eu/blue-card.astro', lastVerified: '2026-07-22', reviewBy: '2027-01-22', title: 'The EU Blue Card in Italy', titleIt: 'La Carta blu UE in Italia' },
  { en: 'src/pages/citizenship.astro', it: 'src/pages/it/citizenship.astro', lastVerified: '2026-07-22', reviewBy: '2027-01-22', title: 'Italian citizenship: the honest orientation', titleIt: "Cittadinanza italiana: l'orientamento onesto" },
  { en: 'src/pages/renting.astro', it: 'src/pages/it/renting.astro', lastVerified: '2026-07-23', reviewBy: '2027-01-23', title: 'Renting a home in Italy', titleIt: 'Affittare casa in Italia' },
  { en: 'src/pages/schools.astro', it: 'src/pages/it/schools.astro', lastVerified: '2026-07-23', reviewBy: '2027-01-23', title: 'School in Italy: enrolling your children', titleIt: 'Scuola in Italia: iscrivere i figli' },
  { en: 'src/pages/driving.astro', it: 'src/pages/it/driving.astro', lastVerified: '2026-07-24', reviewBy: '2027-01-24', title: 'Driving in Italy on a foreign licence', titleIt: 'Guidare in Italia con la patente estera' },
  { en: 'src/pages/banking.astro', it: 'src/pages/it/banking.astro', lastVerified: '2026-07-28', reviewBy: '2027-01-28', title: 'Opening a bank account in Italy', titleIt: 'Aprire un conto bancario in Italia' },
  { en: 'src/pages/pets.astro', it: 'src/pages/it/pets.astro', lastVerified: '2026-07-30', reviewBy: '2027-01-30', title: 'Moving to Italy with a dog, cat or ferret', titleIt: 'Trasferirsi in Italia con un cane, un gatto o un furetto' },
  { en: 'src/pages/from/united-states.astro', it: 'src/pages/it/from/united-states.astro', lastVerified: '2026-07-30', reviewBy: '2027-01-30', title: 'Moving to Italy from the United States', titleIt: 'Trasferirsi in Italia dagli Stati Uniti' },
];

/** Page URL for an entry, derived from its EN file path. */
export const orientationUrl = (entry) =>
  '/' + entry.en.replace(/^src\/pages\//, '').replace(/\.astro$/, '');
