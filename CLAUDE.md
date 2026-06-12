# Trasferirsi in Italia

Authoritative, dated, primary-source-cited reference for relocating to Italy.
Astro static site (zero-JS by default) + content collections, Tailwind v4,
bilingual EN/IT. The citability contract (sources + `lastVerified`/`reviewBy`
dates) is enforced by `src/content.config.ts` and `scripts/check-freshness.mjs`
— the build fails without them. See `README.md` for the full content model.

## gstack

This repo uses [gstack](https://github.com/garrytan/gstack) skills.

- **Use the `/browse` skill from gstack for all web browsing.** It is the only
  sanctioned way to drive a browser here (QA, dogfooding, fetching pages).
- **Never use `mcp__claude-in-chrome__*` tools.** Route every browser action
  through `/browse` instead.

### Available gstack skills

`/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`,
`/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`,
`/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`,
`/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`,
`/setup-gbrain`, `/retro`, `/investigate`, `/document-release`,
`/document-generate`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`,
`/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`,
`/gstack-upgrade`, `/learn`.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
