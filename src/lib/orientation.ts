import { orientationPages, orientationUrl, type OrientationPage } from '../data/orientation-pages.mjs';
import type { Locale } from '../i18n/ui';

/**
 * Typed access to the orientation-page registry (src/data/orientation-pages.mjs),
 * which is plain .mjs so the node build scripts can import it too.
 *
 * The registry is the single source of truth for these pages' verification
 * dates, so the JSON-LD emitted by BaseLayout cannot drift from the date shown
 * on the page — scripts/check-freshness.mjs already asserts the two agree.
 */
export type { OrientationPage };
export const pages: OrientationPage[] = orientationPages;

/** '/banking', '/non-eu/blue-card', … (English, unprefixed). */
export const pathOf = (entry: OrientationPage): string => orientationUrl(entry);

/** Localized page title. */
export const titleOf = (entry: OrientationPage, locale: Locale): string =>
  locale === 'it' ? entry.titleIt : entry.title;

/** Strip the /it prefix and any trailing slash, so both twins map to one key. */
const normalize = (pathname: string): string => {
  const p = pathname.replace(/^\/it(?=\/|$)/, '').replace(/\/+$/, '');
  return p === '' ? '/' : p;
};

/** The registry entry for a URL path, if that path is an orientation page. */
export function findByPath(pathname: string): OrientationPage | undefined {
  const key = normalize(pathname);
  return pages.find((e) => pathOf(e) === key);
}

/**
 * The parent orientation page, for nested routes like /non-eu/blue-card →
 * /non-eu. Returns undefined for top-level pages.
 */
export function parentOf(entry: OrientationPage): OrientationPage | undefined {
  const path = pathOf(entry);
  const parentPath = path.slice(0, path.lastIndexOf('/'));
  if (!parentPath) return undefined;
  return pages.find((e) => pathOf(e) === parentPath);
}
