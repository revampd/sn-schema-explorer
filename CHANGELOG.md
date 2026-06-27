# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Cross-instance metadata sections in the export** (foundation for the v1.0.3
  multi-instance toolbox, [#97](https://github.com/revampd/sn-schema-explorer/issues/97)).
  The Node extractor gains `--metadata=plugins,storeApps,customApps,properties`
  (env `SN_METADATA`) to emit an opt-in top-level `_metadata` block plus
  `_capabilities.metadata.<section>` flags (`enabled`, `count`, and for
  properties `valuesIncluded`/`redactedCount`). The shape is defined once in the
  shared builder so all exporters stay aligned. `sys_properties` **values are off
  by default**; `--include-property-values` opts in, gated by a central denylist
  (`password|secret|key|token|cred|private|passwd`) that redacts matching values.
  `--property-query` (env `SN_PROPERTY_QUERY`) narrows which properties export.
  Metadata is JSON-only.
- **Background-script support for the same metadata sections**
  ([#98](https://github.com/revampd/sn-schema-explorer/issues/98)). The bg script
  gains `CONFIG.metadataSections`, `includePropertyValues`, `propertyValueDenylist`,
  and `propertyEncodedQuery`, with flat GlideRecord fetchers that produce the
  identical shape to the Node extractor (shape defined once in the shared
  builder). Values are off by default and read from the DB only when opted in.
- **Multi-instance registry state** (internal foundation for the upcoming
  landing page, [#99](https://github.com/revampd/sn-schema-explorer/issues/99)).
  New `core/instances-state.js` holds registered instances with presence-based
  capability detection and list-only persistence (`snse:instances:v1`; heavy
  schema data stays in memory). No user-facing change yet — tools become
  registry consumers in later PRs.

### Changed

- Both exporters now read the active-plugin count from `sys_plugins`
  (`active=true`) instead of `v_plugin` (`active=active`), retiring `v_plugin`
  from the exporter.

## [1.0.2] - 2026-06-26

Hardening, testing, and quality pass addressing a full repository audit
([#50](https://github.com/revampd/sn-schema-explorer/issues/50)) and the v1.0.2
backlog ([#38](https://github.com/revampd/sn-schema-explorer/issues/38),
[#41](https://github.com/revampd/sn-schema-explorer/issues/41)–[#49](https://github.com/revampd/sn-schema-explorer/issues/49)).

### ⚠ Breaking

- **Node extractor no longer accepts credentials as command-line arguments.**
  Passing `--password` or `--apikey` now exits with an error. Provide secrets via
  the `SN_PASSWORD` / `SN_APIKEY` environment variables instead — command-line
  arguments leak into shell history and process listings.

### Added

- **Table Access** filter condition (`package_private` / `public`) in the filter
  builder ([#41](https://github.com/revampd/sn-schema-explorer/issues/41)).
- Optional **update check** — once per session, a dismissible footer badge links
  to a newer GitHub release when one exists. Off-able in Settings; the only
  network call is a single GET to the public releases API, no telemetry
  ([#45](https://github.com/revampd/sn-schema-explorer/issues/45)).
- ESLint (flat config) and Prettier configuration, plus `lint`, `format`,
  `format:check`, and `test:coverage` npm scripts.
- Code-coverage reporting (vitest v8) with a ratcheted CI threshold.
- CI: lint job, `npm audit`, and a Node `[20, 22, 24]` test matrix; the release
  workflow now runs lint + unit + build + e2e before publishing.
- Extensive unit + e2e test suites — Node extractor, export serialisers, state
  round-trip, pathfinding, schema builder, filter UI, the shared autocomplete,
  and e2e for export formats, Path Finder, Schema Diff, and the filter builder.
- `CHANGELOG.md`, `CONTRIBUTING.md`, and `.editorconfig`.
- Optional **edge-type legend in image exports** — a toggle in the Export menu
  embeds the edge-type legend (only the types currently shown on the canvas) into
  PNG and SVG exports; off by default
  ([#89](https://github.com/revampd/sn-schema-explorer/issues/89)).

### Changed

- Path Finder: the **Hop exclusions** section now sits above the _Find shortest
  path_ button (exclusions constrain the search, so they belong with the inputs)
  ([#89](https://github.com/revampd/sn-schema-explorer/issues/89)).
- Internal refactor — large source files split into cohesive modules with **zero
  behaviour change** ([#73](https://github.com/revampd/sn-schema-explorer/issues/73)):
  the viewer/Node/Background export serialisers, the Path Finder config and
  hop-exclusions UI, the advanced-filter evaluation core, the Schema Diff
  inspector, the render instance-info pill/modal, and the two large stylesheets
  (`schema-map`, `core`) now live in focused sibling modules / CSS partials. The
  built outputs (single HTML, exporter scripts) are byte-for-byte unchanged.
- Saved-view naming and "Open in ServiceNow" now use an inline modal input
  instead of the blocking `window.prompt()` (which some browser-hardening
  policies suppress); "Open in ServiceNow" opens directly when the instance is
  already known from the loaded schema
  ([#46](https://github.com/revampd/sn-schema-explorer/issues/46)).
- The in-app guide was corrected to match the implementation — filter conditions,
  the AND/OR connectors, the operator cycle, and the Export/Filter controls
  ([#48](https://github.com/revampd/sn-schema-explorer/issues/48)).
- `package.json` now declares `engines.node >= 20` (required by the dev
  toolchain; the standalone exporter artifact still runs on Node 18+).
- Codebase formatted with Prettier; `format:check` is enforced in CI.
- Internal refactors: the filter builder and Path Finder share one autocomplete
  keyboard-nav core, sidebar visibility is centralised across view modes, and the
  graph index builder is shared
  ([#42](https://github.com/revampd/sn-schema-explorer/issues/42),
  [#46](https://github.com/revampd/sn-schema-explorer/issues/46)).

### Removed

- The non-functional "Expand references" canvas context-menu item
  ([#49](https://github.com/revampd/sn-schema-explorer/issues/49)).

### Fixed

- Background script: the JSON split thresholds are lowered to **10 MB** (both the
  single-attachment trigger and the per-part size) to cap peak in-memory string
  size and avoid memory pressure on large exports inside ServiceNow
  ([#89](https://github.com/revampd/sn-schema-explorer/issues/89)).
- Path Finder sidebar scrollbar is now styled to match the app's other custom
  scrollbars ([#89](https://github.com/revampd/sn-schema-explorer/issues/89)).
- Node extractor: pagination now has a safety cap (no infinite loop on
  misbehaving/duplicate pages) and HTTP responses are size-capped to avoid heap
  exhaustion.
- Background script: user-supplied record-count regex patterns are compiled
  defensively (an invalid pattern is skipped with a warning instead of aborting
  the export); `sys_dictionary` is queried with `active!=false` to match the Node
  extractor so both exporters return the same row set.
- Path Finder no longer returns stale results after a Schema Diff comparison
  (its adjacency cache is invalidated when the graph is re-indexed).
- Viewer: memoised `filterOk`; `localStorage` write failures now warn instead of
  failing silently; canvas label-truncation off-by-one fixed; zoom-time indicator
  updates read from the simulation instead of re-scanning the DOM; the filter
  "+ Add condition" picker and autocomplete dropdowns are body-portalled so they
  can't be clipped.
- `build.js app` fails with a clear message when the exporter `dist/` files are
  missing, instead of an opaque `ENOENT`.

### Security

- Escape schema-derived values in the density-info line and the Schema Diff list
  (previously interpolated into `innerHTML`), preventing script execution from a
  maliciously crafted schema file
  ([#46](https://github.com/revampd/sn-schema-explorer/issues/46)).

## [1.0.1] - 2026-05-24

### Added

- `--format` and `--edge-types` flags for the Node.js extractor.

### Changed

- Documentation updates: single build target, corrected commands, new features.

## [1.0.0] - 2026-05-22

Initial public release.

- Force-directed Schema Map with adjustable hop depth, max nodes, and edge-type
  filters; advanced filter builder.
- Inspector for fields, inheritance, references, M2M, and CMDB CI topology.
- Search by table or field name; Path Finder; Schema Diff; Saved Views.
- Export as PNG, SVG, JSON, Markdown, JSON-LD, OWL/Turtle, or OpenAPI YAML.
- Background Script and Node.js schema extractors.

[Unreleased]: https://github.com/revampd/sn-schema-explorer/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/revampd/sn-schema-explorer/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/revampd/sn-schema-explorer/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/revampd/sn-schema-explorer/releases/tag/v1.0.0
