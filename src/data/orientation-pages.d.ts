export interface OrientationPage {
  /** Repo-relative path of the English page, e.g. 'src/pages/banking.astro'. */
  en: string;
  /** Repo-relative path of the Italian twin. */
  it: string;
  /** ISO date (yyyy-mm-dd) the page's facts were last verified. */
  lastVerified: string;
  /** ISO date by which the page should be re-verified. */
  reviewBy: string;
  title: string;
  titleIt: string;
}

export const orientationPages: OrientationPage[];
export function orientationUrl(entry: OrientationPage): string;
