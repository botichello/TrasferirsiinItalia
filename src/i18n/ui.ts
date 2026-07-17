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
  guide: {
    home: string;
    euCitizens: string;
    residency: string;
    /** Builds "Step N · EU residency journey". */
    stepLabel: (n: number) => string;
    lastVerified: string;
    reviewDue: string;
    sources: string;
    sourcesIntro: string;
    checkedOn: string;
    archived: string;
    documents: string;
    reset: string;
    reportPrompt: string;
    reportLink: string;
    /** Builds "Verified N times since <date>." */
    historySummary: (n: number, since: string) => string;
    allUpdates: string;
    tocHeading: string;
    faqHeading: string;
    prevStep: string;
    nextStep: string;
  };
}

export const ui: Record<Locale, Strings> = {
  en: {
    htmlLang: 'en',
    skip: 'Skip to content',
    nav: [
      { href: '/start', label: 'Start here' },
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
      { href: '/sources', label: 'Sources' },
      { href: '/updates', label: 'Updates' },
      { href: '/glossary', label: 'Glossary' },
      { href: '/search', label: 'Search' },
    ],
    disclaimer:
      'Informational only — not legal or tax advice. Procedures change; always confirm with the official sources cited on each page or the relevant Italian authority before acting.',
    switchLabel: 'Italiano',
    switchHref: '/it',
    guide: {
      home: 'Home',
      euCitizens: 'EU citizens',
      residency: 'Residency',
      stepLabel: (n) => `Step ${n} · EU residency journey`,
      lastVerified: 'Last verified',
      reviewDue: 'Review due',
      sources: 'Sources',
      sourcesIntro:
        'Primary, official sources this page is based on. Each was checked on the date shown.',
      checkedOn: 'checked',
      archived: 'archived copy',
      documents: 'Documents to bring',
      reset: 'Reset',
      reportPrompt: 'Spotted something out of date?',
      reportLink: 'Suggest an update →',
      historySummary: (n, since) =>
        n === 1 ? `Verified once, on ${since}.` : `Verified ${n} times since ${since}.`,
      allUpdates: 'See all updates →',
      tocHeading: 'On this page',
      faqHeading: 'Frequently asked questions',
      prevStep: 'Previous step',
      nextStep: 'Next step',
    },
  },
  it: {
    htmlLang: 'it',
    skip: 'Vai al contenuto',
    nav: [
      { href: '/it/start', label: 'Inizia qui' },
      { href: '/it/cities', label: 'Città' },
      { href: '/it/regions', label: 'Regioni' },
      { href: '/it/how-we-verify', label: 'Come verifichiamo' },
      { href: '/it/about', label: 'Chi siamo' },
    ],
    footerNav: [
      { href: '/it/cities', label: 'Sfoglia città' },
      { href: '/it/regions', label: 'Sfoglia regioni' },
      { href: '/it/about', label: 'Chi siamo' },
      { href: '/it/how-we-verify', label: 'Come verifichiamo' },
      { href: '/it/sources', label: 'Fonti' },
      { href: '/it/updates', label: 'Aggiornamenti' },
      { href: '/it/glossary', label: 'Glossario' },
      { href: '/', label: 'English site' },
    ],
    disclaimer:
      'Solo a scopo informativo — non costituisce consulenza legale o fiscale. Le procedure cambiano; verifica sempre con le fonti ufficiali citate in ogni pagina o con l’autorità italiana competente prima di agire.',
    switchLabel: 'English',
    switchHref: '/',
    guide: {
      home: 'Home',
      euCitizens: 'Cittadini UE',
      residency: 'Residenza',
      stepLabel: (n) => `Passo ${n} · Percorso di residenza UE`,
      lastVerified: 'Verificato il',
      reviewDue: 'Revisione dovuta',
      sources: 'Fonti',
      sourcesIntro:
        'Le fonti ufficiali primarie su cui si basa questa pagina. Ciascuna è stata controllata nella data indicata.',
      checkedOn: 'controllata il',
      archived: 'copia archiviata',
      documents: 'Documenti da portare',
      reset: 'Reimposta',
      reportPrompt: 'Hai notato qualcosa di superato?',
      reportLink: 'Proponi un aggiornamento →',
      historySummary: (n, since) =>
        n === 1 ? `Verificata una volta, il ${since}.` : `Verificata ${n} volte dal ${since}.`,
      allUpdates: 'Tutti gli aggiornamenti →',
      tocHeading: 'In questa pagina',
      faqHeading: 'Domande frequenti',
      prevStep: 'Passo precedente',
      nextStep: 'Passo successivo',
    },
  },
};
