# Contributing

Thanks for your interest in improving Schema Explorer for ServiceNow. This is a
community tool — not affiliated with ServiceNow, Inc.

## Prerequisites

- Node.js **22+**
- npm

## Setup

```bash
git clone https://github.com/revampd/sn-schema-explorer.git
cd sn-schema-explorer
npm install
```

## Build

```bash
npm run build        # all targets → dist/
npm run build:app    # dist/sn_schema_explorer.html
npm run build:export # dist/exporter/* (bg script + node extractor)
```

Open `dist/sn_schema_explorer.html` in any browser to try your changes — the app
is a single self-contained file with no server.

## Tests, lint, and coverage

```bash
npm run lint           # ESLint (must be clean — 0 errors)
npm run format         # apply Prettier (optional; format:check is non-blocking in CI)
npm run test:unit      # vitest unit tests
npm run test:coverage  # unit tests + coverage (CI enforces a minimum threshold)
npm run test:e2e       # Playwright e2e (runs against the built dist/ — build first)
npm test               # unit + e2e
```

E2E tests run against the built HTML, so run `npm run build` before `test:e2e`.
On first run, install the browser: `npx playwright install chromium`.

Please make sure `npm run lint` and `npm test` pass before opening a PR. If you
add or change source under `src/`, add or update tests accordingly — coverage
thresholds are ratcheted and CI will fail on a regression.

## Branching & pull requests

- Branch from `dev` using `feature/<short-name>` or `fix/<short-name>`. CI runs
  on `feature/**`, `fix/**`, and `release/**` branches and on PRs into
  `release/**`.
- Keep PRs focused; describe what changed and how you verified it.
- Note any breaking changes explicitly and update `CHANGELOG.md` under
  `[Unreleased]`.

## Releases

Releases are tag-driven. Pushing a `vX.Y.Z` tag triggers the release workflow,
which runs lint + unit tests + build + e2e and then publishes the built
artifacts (`sn_schema_explorer.html`, the background script, and the standalone
Node extractor) to a GitHub Release.

Before tagging:

1. Move the `[Unreleased]` changelog entries under the new version in
   `CHANGELOG.md` and bump `version` in `package.json`.
2. Add the user-facing release notes at `docs/release-notes/<tag>.md` (e.g.
   `docs/release-notes/v1.0.2.md`). **This file is the full GitHub Release body** —
   the release workflow publishes it verbatim via `body_path` and fails the
   release if it is missing, so it must include the feature summary _and_ the
   Downloads table. See the existing files for the format.
