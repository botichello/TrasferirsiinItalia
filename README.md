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

### Local overlays (region & comune)

The national guides are layered with location-specific overlays, matching how
Italy actually works:

- **Comune overlays** — `src/content/comune-notes/<city>/<guide>.md` — for the
  **anagrafe** step (residency registration is run per comune). Frontmatter:
  `city`, `guide`, `sources` (≥1), `lastVerified`, `reviewBy`.
- **Region overlays** — `src/content/region-notes/<region>/<guide>.md` — for the
  **SSN** step (the health authority is regional). Same contract.

Selection is by **city** (`/cities/<city>/residency/<step>`, cities grouped by
region in the selector). A city page composes: national base + the comune overlay
for anagrafe + the region overlay for SSN. The **codice fiscale is national and
uniform** — there is no comune-specific procedure, only the local Agenzia delle
Entrate office, and the page says so. Pages self-canonicalize only when they carry
a substantive overlay; otherwise they consolidate to the national (or, for SSN,
the region) page, so near-duplicate pages aren't penalized.

Cities and regions are curated in `src/data/cities.ts` and `src/data/regions.ts`.

## ⚠️ Accuracy note

The seed content is an **initial draft based on EU free-movement rules and the
cited official sources**. Before launch, every procedural detail must be
re-verified against the primary sources (Agenzia delle Entrate, Ministero
dell'Interno, Ministero della Salute, the relevant comune/ASL, and Your Europe).
Pages that depend on regional rules (notably SSN enrolment for economically
inactive EU citizens) are flagged inline. This site is informational, not legal
or tax advice.

## Internationalisation (i18n)

English is the default (unprefixed) locale; Italian is served under `/it/`
(`astro.config.mjs` → `i18n`). Chrome strings live in `src/i18n/ui.ts`; guide
content carries a `lang` field (Italian guides under `src/content/guides/it/`),
and region/comune overlays carry `lang` too (Italian overlays under
`it/<place>/`). The national journey, the trust/landing pages, and the major
cities (Roma, Milano, Napoli, Torino, Firenze, Bologna) are fully Italian
end-to-end; other localities fall back to honest Italian "national procedure"
text. `hreflang` alternates are emitted on the bilingual pages.

## Roadmap

1. ✅ Scaffold + enforced content schema + Step 1–3 of the EU journey.
2. ✅ Region layer — SSN health authority for all 20 regions.
3. ✅ City layer — comune anagrafe overlays for the 34 largest cities /
   provincial capitals, with selection by city.
4. ✅ Findability & Trust — search, browse hubs, About/How-we-verify, schema.
5. ✅ Italian (i18n) — national journey, all 20 region SSN overlays, and the 34
   city anagrafe overlays, end-to-end.
6. 🔶 Verify draft content against primary sources. **Done (2026-06-12, against
   the live official sites):** the three national guides (codice fiscale,
   anagrafe, SSN) in both languages, plus a full link audit of every cited
   source — all dead or redirected citations were repaired (see below).
   **Remaining:** the region-specific SSN detail and per-comune procedures keep
   their draft date pending a content-level pass.
7. Smaller comuni keep the honest national-procedure fallback (their process is
   the uniform national ANPR flow); add overlays on request. Then the non-EU
   visa journey.

## Verifying content (network policy)

A verification pass needs to reach the official Italian/EU sites. Earlier build
sessions ran under a locked-down egress allowlist that blocked them (and
`cdn.playwright.dev`, which disables the `/browse` skill), so content was drafted
from `WebSearch` alone. In a session whose network policy allows those hosts the
pass can be done for real — as of **2026-06-12**:

- All cited source URLs were swept for link health. Dead citations (404/410, plus
  one comune link that had started redirecting to a parked domain) were replaced
  with their current official URLs, and the national guides were re-checked
  against the live pages.
- A handful of comune/ASL portals (e.g. Catania, Trieste, Reggio Emilia, Napoli,
  and several regional health sites) sit behind anti-bot protection and return
  403/503 to automated fetches while resolving normally in a real browser — they
  are kept as valid sources.
- Tooling note: the egress proxy re-signs TLS with a private CA that Node and
  `curl` trust (so `WebFetch`/`curl` work) but Playwright's bundled Chromium does
  not, so the `/browse` skill hits a certificate error in this environment;
  verification used `curl` + `WebFetch`, with `WebSearch` as a fallback.
