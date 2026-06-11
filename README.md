# Trasferirsi in Italia

An authoritative, dated, primary-source-cited reference for relocating to Italy —
built so that both humans and AI assistants can trust and cite it.

**v1 scope (locked):** the **EU/EEA-citizen national residency journey** —
`codice fiscale → iscrizione anagrafica → SSN`. Non-EU and city/comune-specific
content are deliberately deferred so the v1 slice can be kept genuinely accurate.

## The core idea

Authority comes from being **accurate, dated, and sourced on a narrow slice** —
not broad and stale. So the citability discipline is mechanical, not aspirational:

- The content schema (`src/content.config.ts`) **fails the build** if a guide page
  has no primary `sources` or is missing `lastVerified` / `reviewBy` dates.
- `scripts/check-freshness.mjs` re-checks this before every build and in CI, and
  the scheduled GitHub Action (`.github/workflows/freshness.yml`) turns overdue
  pages into a red check so they get re-verified.
- Every page renders a visible **"Last verified"** badge and a **Sources** list.
- `llms.txt`, `robots.txt` (AI crawlers welcomed), `sitemap.xml`, and schema.org
  JSON-LD (`HowTo` + `FAQPage`) make the content easy and unambiguous to cite.

## Tech

- [Astro](https://astro.build) (static, zero-JS by default) + content collections
- Tailwind CSS v4 (via `@tailwindcss/vite`)
- One vanilla-JS island: the document checklist (localStorage-persisted)

## Develop

```bash
npm install
npm run dev          # local dev server
npm run build        # runs the freshness gate, then builds to dist/
npm run check:freshness   # the freshness gate on its own
```

## Content model

Guide pages live in `src/content/guides/*.md`. Required frontmatter:

| field          | meaning                                                        |
| -------------- | -------------------------------------------------------------- |
| `title`        | page title                                                     |
| `description`  | ≤200 chars; used for meta + structured data                    |
| `step`         | position in the journey (1, 2, 3 …)                            |
| `journey`      | currently always `eu-residency`                                |
| `lastVerified` | date a human last confirmed the content against sources        |
| `reviewBy`     | date the page is next due for review (must be after the above) |
| `regionScope`  | `national` \| `regional` \| `comune`                           |
| `sources`      | **≥1** primary source `{ title, url, accessed }`               |
| `documents`    | optional — drives the interactive document checklist           |
| `faq`          | optional — on-page Q&A + `FAQPage` JSON-LD                     |

## ⚠️ Accuracy note

The seed content is an **initial draft based on EU free-movement rules and the
cited official sources**. Before launch, every procedural detail must be
re-verified against the primary sources (Agenzia delle Entrate, Ministero
dell'Interno, Ministero della Salute, the relevant comune/ASL, and Your Europe).
Pages that depend on regional rules (notably SSN enrolment for economically
inactive EU citizens) are flagged inline. This site is informational, not legal
or tax advice.

## Roadmap

1. ✅ Scaffold + enforced content schema + Step 1–3 of the EU journey.
2. Re-verify all content against primary sources; remove draft banners.
3. Add region layer (start with SSN voluntary-contribution differences).
4. Expand to a high-demand city's comune specifics, or the non-EU visa journey.
