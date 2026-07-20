# Contributing

This site's entire value is that it is **accurate, dated, and sourced**. The
discipline is mechanical: the build fails when content breaks the contract.
This file is the playbook for changing content without breaking trust.

## The citability contract

Every guide and every local overlay MUST carry:

- `lastVerified` — the date a human last confirmed the content against its
  sources (not the date you edited the file);
- `reviewBy` — when it is next due (typically +6 months; must be later);
- `sources` — **≥ 1 primary, official** source (`{title, url, accessed}`).
  Government/EU portals only; never blogs, forums, or news articles.

Enforced by `src/content.config.ts` (schema) and `scripts/check-freshness.mjs`
(part of `npm run build`). The scheduled freshness workflow flags overdue pages.

**Rule of thumb: never state a fact you did not read on a fetched official
page.** If a claim can't be sourced, cut it or mark the page's scope honestly.

## Verifying / re-verifying a page

1. Fetch every cited source (a plain `curl -A "Mozilla/5.0 …"` works on most;
   some comune/ASL portals are bot-walled — see `KNOWN_BOTWALL` in
   `scripts/check-links.mjs`; use the archived copy for reading).
2. Re-read the page against the sources; fix drift.
3. Bump `lastVerified` (+ each source's `accessed`) and `reviewBy`.
4. `npm run check:links` — dead/hijacked citations fail; new bot-walls get
   added to the known list *only after* confirming the URL works in a browser
   or the Wayback Machine.
5. `npm run fetch:archives` — refresh Wayback snapshots (merges; never drops).
6. `npm run build:history` — regenerate the verification log that powers
   `/updates` and the per-page "Verified N times" line.

## Adding a city (comune overlay)

1. Ensure the city exists in `src/data/cities.ts` (slug, name, province, region).
2. Write `src/content/comune-notes/<slug>/iscrizione-anagrafica.md` (EN) and
   `src/content/comune-notes/it/<slug>/iscrizione-anagrafica.md` (IT,
   `lang: it`), following an existing example (Bergamo is a good template):
   office + address, submission channels (ANPR / PEC / desk / booking),
   EU-citizen documents, local quirks. 15–30 lines; cite the comune pages you
   actually fetched.
3. The city page then self-canonicalizes and enters the sitemap automatically;
   no route changes needed.

Region overlays (`src/content/region-notes/<region>/servizio-sanitario.md`)
follow the same contract; the health authority is the regional element.

## Adding a journey step (guide)

1. `src/content/guides/<slug>.md` (+ `it/<slug>.md` with `lang: it`): pick the
   next `step` number; description ≤ 200 chars; add `documents` (drives the
   checklist + /checklist page) and `faq` (rendered on-page + FAQPage JSON-LD).
2. Add a compact label in `src/components/JourneyNav.astro` (`short` map) and
   an icon in `src/components/StepIcon.astro`.
3. Add city-page fallback texts in both
   `src/pages/{,it/}cities/[city]/residency/[guide].astro` (`fallbacks` map).
4. `npm run gen:og` — regenerate the per-guide social cards.
5. Consider glossary terms (`src/data/glossary.ts`) and wizard entries
   (`src/components/StartWizard.astro`, steps list) for the new step.

## Gates — all run in `npm run build` and CI

| gate                | catches                                                        |
| ------------------- | -------------------------------------------------------------- |
| `check:freshness`   | missing/overdue dates, missing sources                          |
| `check:seo`         | canonical/hreflang/sitemap/JSON-LD errors, broken internal links |
| `test:smoke`        | broken JS islands (search, wizard, checklist), a11y regressions |

Run `npm run test:smoke` locally after touching any island or layout
(`CHROMIUM_PATH` selects the browser binary if Playwright's registry is empty).

## Language

English is the default locale; Italian lives under `/it/` and is a first-class
translation, not an afterthought: natural idiomatic Italian, "tu" register,
identical facts and sources. Chrome strings live in `src/i18n/ui.ts`.

## The launch switch

`SEARCH_INDEXING` in `src/data/site.ts` keeps the site `noindex` + fully
`Disallow`ed while false. Flip it, deploy, submit the sitemap in Search
Console, and run `npm run submit:indexnow` when going public.
