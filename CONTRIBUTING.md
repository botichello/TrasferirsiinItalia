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

Frontmatter schemas are `.strict()`: an unrecognised key is an error, not a
shrug. Without it, a guide with `documnets:` built green and shipped an empty
document checklist — a misspelling that degrades silently is worse than one that
fails.

## Verifying / re-verifying a page

1. Fetch every cited source (a plain `curl -A "Mozilla/5.0 …"` works on most;
   some comune/ASL portals are bot-walled — see `KNOWN_BOTWALL` in
   `scripts/check-links.mjs`; use the archived copy for reading).
2. Re-read the page against the sources; fix drift.
3. If a stated amount or rate moved, retire the old value in
   `src/data/figures.mjs` — the build then finds every other copy of it.
4. Bump `lastVerified` (+ each source's `accessed`) and `reviewBy`.
5. `npm run check:links` — dead/hijacked citations fail; new bot-walls get
   added to the known list *only after* confirming the URL works in a browser
   or the Wayback Machine.
6. `npm run fetch:archives` — refresh Wayback snapshots (merges; never drops).
7. `npm run build:history` — regenerate the verification log that powers
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
| `check:figures`     | a statutory amount or rate that stopped being true              |
| `check:theme`       | a literal colour with no dark-mode override                      |
| `check:seo`         | canonical/hreflang/sitemap/JSON-LD errors, broken internal links |
| `check:prose`       | walls of text — a paragraph or sentence past the readable limit  |
| `test:smoke`        | broken JS islands, a11y + contrast in both themes, layout overflow at phone widths |
| `check:journeys`    | orphan pages, locale asymmetries, dead ends — can a human get there? |
| `test:gates`        | any gate rule that has stopped firing                            |

Run `npm run test:smoke` locally after touching any island or layout
(`CHROMIUM_PATH` selects the browser binary if Playwright's registry is empty).

`check:journeys` walks the site the way a reader does — links inside `<main>`
only, ignoring the header and footer chrome that would make everything
trivially reachable — and asserts every page is reachable from **its own
locale's** homepage and offers at least one onward link. It exists because
`/from/united-states` once shipped reachable only from the footer: correct
canonicals, valid schema, in the sitemap and in `llms.txt`, link-checked, and
invisible to a person. Machine discoverability was instrumented; human
discoverability was not. Nav-only pages are allowed by name, with a reason.

`check:figures` is the one gate that reads *numbers* rather than structure.
`src/data/figures.mjs` records, per tracked figure, the literals that are no
longer true, and the build refuses to contain them. It exists because the
tax-residency guide was re-verified in July 2026 still saying the middle IRPEF
band was 35%, when it had been 33% since 1 January 2026 — and the figure was
stated in four files, so fixing the one you happened to read would have left
three. **Correcting an amount means retiring the old value here**, which is what
makes the other copies fail loudly. Prose that names an old figure on purpose
("was 35% through 2025") is exempted by exact phrase, and the phrase must still
exist, so an exemption cannot outlive the sentence that earned it.

`check:theme` guards the one thing a colour token cannot do for itself.
`text-muted` and `bg-surface/60` resolve through custom properties, so they flip
under `prefers-color-scheme` automatically; a *literal* like `bg-white/90` or
`text-amber-800` does not, and needs an explicit override in the dark block of
`global.css`. The gate fails on any literal that has neither an override nor an
allowlist entry — and on any override whose class no longer appears in the
source. It exists because the dark block enumerated `bg-white/60`, `/70` and
`bg-white`, the start wizard's controls panel used `bg-white/90`, and it shipped
90% white with near-white text: **1.01:1**, invisible buttons, on the page whose
whole job is to orient a new reader.

The fix in that case was structural rather than one more override. Surfaces now
go through `--color-surface`, and the brand scale was split by role, because one
value cannot serve both: `--color-link` brightens in dark mode so link text
reads on near-black, while `--color-fill` stays dark so `--color-onfill` white
still reads on it. Reach for `bg-surface`, `text-link`, `bg-fill`/`text-onfill`,
`text-muted` before reaching for a literal.

`test:smoke` measures the result: axe's `color-contrast` rule over every page
template in both themes, with the start wizard's active state exercised so the
highlighted and dimmed rows are measured too. The original dark-mode test
asserted the body background colour and nothing else, so 13 distinct contrast
defects across 386 nodes were invisible to it.

`test:smoke` also asserts **no page is wider than the viewport** at 320/360/390.
That check exists because `/start` overflowed by 23px at 390px and 93px at 320px,
which reached us as "looks great in mobile Chrome, overflows in mobile Brave" —
the page was broken in both, and only one browser made it visible. Two structural
causes: an unwrapped flex row whose minimum width was a fixed `min-w-40` label
column plus a `shrink-0` badge plus the description's min-content width, and PEC
addresses in the comune notes that no engine will break mid-token. The assertion
is at document level (`scrollWidth` vs `clientWidth`), so content inside a
deliberate `overflow-x-auto` container — the journey nav's step pills — is not a
false positive.

`check:prose` is the only gate that reads the writing. Limits: **100 words per
paragraph**, **55 per sentence**, both taken from the site's own distribution
rather than from taste — measured across 34,000 paragraphs and 58,000 sentences,
the median paragraph is 28 words and the median sentence 15, so the limits sit
above the p99 and catch only the tail. That tail was real: a 148-word paragraph
and an 86-word sentence on the citizenship page, which is where a reader sits
while working out whether they qualify for anything at all.

Every outlier turned out to be the same defect — **a list flattened into prose** —
and every fix was to unflatten it. If a long sentence enumerates conditions or
options, it wants to be a `<ul>`; if a paragraph covers two things, it wants to be
two paragraphs. Do not pad the limits to fit new copy.

`test:gates` is the gates' own test: it copies the gate's input (`dist/` for
`check:seo`, `check:journeys` and `check:prose`, `src/` for `check:freshness`,
`check:figures` and `check:theme`), injects one specific fault per case
(a duplicated canonical, a typo'd hreflang code, a guide stripped of its
`sources`, an unregistered orientation page…) and asserts the gate reports it.
It also asserts the *unmodified* input passes, so a broken baseline cannot make
the suite vacuous.

This exists because a gate that has stopped firing still reports success — the
completeness scan here once passed on 24 files while genuinely checking 14, and
every build was green throughout. **If you add a rule to any gate, add a
case to `test-gates.mjs`**: a rule nobody has watched fail is not yet a gate.

## Language

English is the default locale; Italian lives under `/it/` and is a first-class
translation, not an afterthought: natural idiomatic Italian, "tu" register,
identical facts and sources. Chrome strings live in `src/i18n/ui.ts`.

## The launch switch

`SEARCH_INDEXING` in `src/data/site.ts` keeps the site `noindex` + fully
`Disallow`ed while false. Flip it, deploy, submit the sitemap in Search
Console, and run `npm run submit:indexnow` when going public.
