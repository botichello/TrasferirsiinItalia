export type Locale = 'en' | 'it';
export const locales: Locale[] = ['en', 'it'];
export const defaultLocale: Locale = 'en';

/** Derive the active locale from the URL path (/it/... => it). */
export function getLocale(url: URL): Locale {
  return url.pathname.split('/')[1] === 'it' ? 'it' : 'en';
}

/** Prefix a root-relative path for the given locale. */
export function localizePath(path: string, locale: Locale): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return locale === 'en' ? clean : `/it${clean === '/' ? '' : clean}`;
}

interface NavItem {
  href: string;
  label: string;
}

interface Strings {
  htmlLang: string;
  skip: string;
  nav: NavItem[];
  footerNav: NavItem[];
  disclaimer: string;
  switchLabel: string;
  switchHref: string;
}

export const ui: Record<Locale, Strings> = {
  en: {
    htmlLang: 'en',
    skip: 'Skip to content',
    nav: [
      { href: '/cities', label: 'Cities' },
      { href: '/regions', label: 'Regions' },
      { href: '/how-we-verify', label: 'How we verify' },
      { href: '/about', label: 'About' },
      { href: '/search', label: 'Search' },
    ],
    footerNav: [
      { href: '/cities', label: 'Browse cities' },
      { href: '/regions', label: 'Browse regions' },
      { href: '/about', label: 'About' },
      { href: '/how-we-verify', label: 'How we verify' },
      { href: '/search', label: 'Search' },
    ],
    disclaimer:
      'Informational only — not legal or tax advice. Procedures change; always confirm with the official sources cited on each page or the relevant Italian authority before acting.',
    switchLabel: 'Italiano',
    switchHref: '/it',
  },
  it: {
    htmlLang: 'it',
    skip: 'Vai al contenuto',
    nav: [
      { href: '/it', label: 'Home' },
      { href: '/it/about', label: 'Chi siamo' },
      { href: '/it/how-we-verify', label: 'Come verifichiamo' },
      { href: '/', label: 'English' },
    ],
    footerNav: [
      { href: '/it/about', label: 'Chi siamo' },
      { href: '/it/how-we-verify', label: 'Come verifichiamo' },
      { href: '/', label: 'English site' },
    ],
    disclaimer:
      'Solo a scopo informativo — non costituisce consulenza legale o fiscale. Le procedure cambiano; verifica sempre con le fonti ufficiali citate in ogni pagina o con l’autorità italiana competente prima di agire.',
    switchLabel: 'English',
    switchHref: '/',
  },
};
