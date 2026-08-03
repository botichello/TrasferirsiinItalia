export interface SourceNote {
  /** The module this note attaches to: an orientation path ('/driving') or a
   *  journey guide slug ('residenza-fiscale'). */
  module: string;
  headingEn: string;
  headingIt: string;
  /** The note itself. Plain text — no markup, so it is safe to render anywhere. */
  en: string;
  it: string;
  /** ISO date (yyyy-mm-dd) this note's facts were last verified. */
  lastVerified: string;
  sources: { title: string; url: string }[];
}

export interface SourceCountry {
  /** URL slug, e.g. 'united-states' → /from/united-states. */
  slug: string;
  /** ISO 3166-1 alpha-2. */
  code: string;
  nameEn: string;
  nameIt: string;
  fromEn: string;
  fromIt: string;
  notes: SourceNote[];
}

export const sourceCountries: SourceCountry[];
export function getSourceCountry(slug: string): SourceCountry | undefined;
export function notesForModule(module: string): { country: SourceCountry; note: SourceNote }[];
export function latestVerified(country: SourceCountry): string;
