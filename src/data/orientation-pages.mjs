/**
 * Registry of the orientation pages (src/pages/*.astro outside the content
 * collections) so they get the same freshness discipline as the guides:
 * scripts/check-freshness.mjs fails the build if an entry's reviewBy is not
 * after lastVerified, warns when overdue, verifies both language files exist,
 * checks the page's own <time datetime> matches lastVerified, and catches any
 * unregistered page carrying the orientation sentinel.
 *
 * When re-verifying a page: update its on-page date AND this entry.
 * Plain .mjs so the node scripts can import it without a TS toolchain.
 */
export const orientationPages = [
  { en: 'src/pages/non-eu.astro', it: 'src/pages/it/non-eu.astro', lastVerified: '2026-07-20', reviewBy: '2027-01-20' },
  { en: 'src/pages/non-eu/digital-nomad.astro', it: 'src/pages/it/non-eu/digital-nomad.astro', lastVerified: '2026-07-21', reviewBy: '2027-01-21' },
  { en: 'src/pages/non-eu/elective-residence.astro', it: 'src/pages/it/non-eu/elective-residence.astro', lastVerified: '2026-07-22', reviewBy: '2027-01-22' },
  { en: 'src/pages/non-eu/study-visa.astro', it: 'src/pages/it/non-eu/study-visa.astro', lastVerified: '2026-07-22', reviewBy: '2027-01-22' },
  { en: 'src/pages/non-eu/family-reunification.astro', it: 'src/pages/it/non-eu/family-reunification.astro', lastVerified: '2026-07-22', reviewBy: '2027-01-22' },
  { en: 'src/pages/non-eu/long-term-residence.astro', it: 'src/pages/it/non-eu/long-term-residence.astro', lastVerified: '2026-07-22', reviewBy: '2027-01-22' },
  { en: 'src/pages/non-eu/blue-card.astro', it: 'src/pages/it/non-eu/blue-card.astro', lastVerified: '2026-07-22', reviewBy: '2027-01-22' },
  { en: 'src/pages/citizenship.astro', it: 'src/pages/it/citizenship.astro', lastVerified: '2026-07-22', reviewBy: '2027-01-22' },
  { en: 'src/pages/renting.astro', it: 'src/pages/it/renting.astro', lastVerified: '2026-07-23', reviewBy: '2027-01-23' },
  { en: 'src/pages/schools.astro', it: 'src/pages/it/schools.astro', lastVerified: '2026-07-23', reviewBy: '2027-01-23' },
];
