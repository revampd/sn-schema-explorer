# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Shared focus across lenses** (`core/focus-state.js`,
  [#131](https://github.com/revampd/sn-schema-explorer/issues/131); part of the
  [#130](https://github.com/revampd/sn-schema-explorer/issues/130) "integrated
  lenses" epic). A thin facade — `focusState` (`instanceId` / `compareId` /
  `table`) plus an `onFocusChange` event — giving the tools one shared notion of
  "what the user is looking at", over the existing instance/diff/selection state
  (no new storage). The first visible payoff: the table you have selected in
  Schema Map now **carries into Path Finder's source** when you switch lenses,
  instead of starting empty. Substrate for the upcoming entity spine, cross-lens
  overlays, and linked panes.

- **Header tool switcher + instance dropdown**
  ([#127](https://github.com/revampd/sn-schema-explorer/issues/127)). The header
  is reorganised around an always-visible **tool switcher** that replaces the old
  `Schema Map | Path Finder | Diff` segment — it lists every tool available for
  the loaded instance (Schema Map, Path Finder, Schema Diff, Configuration Data)
  and works from any of them, so you can move between tools without going Home. A
  new **instance dropdown** sits beside it: it switches the loaded instance in
  Schema Map / Path Finder, and in Schema Diff it sets the **Base** and stays in
  sync with the sidebar's Base picker. The Home button is now text-only, and
  **Path Finder** is also launchable from an instance card like the other tools.
  ([#126](https://github.com/revampd/sn-schema-explorer/issues/126)). A **⇄**
  button between the Base and Compare pickers flips the two sides in place (the
  current compare becomes the base and vice-versa), so you can reverse the
  direction of a comparison without re-selecting both. Disabled until a compare
  is chosen.

- **App-themed dropdowns everywhere** (`core/dropdown.js`,
  [#126](https://github.com/revampd/sn-schema-explorer/issues/126)). A custom
  dropdown whose open option list is styled to match the app, replacing native
  `<select>`s whose popup is drawn by the OS. Keyboard-accessible (arrows,
  Home/End, Enter/Space, Escape) and ARIA listbox-labelled. Now used for **all**
  single-selects: the Schema Diff Base/Compare pickers, the Configuration Data
  status filter, the advanced filter's edge-type picker, and the background-script
  "Output format" picker. The old native `.sn-select` is retired.

- **Configuration Data: Export JSON**
  ([#126](https://github.com/revampd/sn-schema-explorer/issues/126)). Alongside
  Export CSV, the comparison view can now export the current section as JSON —
  the section, the compared instances, the comparable fields, status counts, and
  one entry per key carrying a per-instance cell (`{ present, …fields }`) — for
  feeding the reconciliation into other tooling.

- **Configuration Data tool**
  ([#104](https://github.com/revampd/sn-schema-explorer/issues/104)). A new
  workspace that views and reconciles a metadata section — **plugins, store apps,
  custom apps, or system properties** — across the instances you've registered.
  Launch it from an instance card's **▦** icon (enable Configuration Data in
  Settings first); it's available from a **single** registered instance (one
  column) and lights up version drift, missing entries, and active-state
  mismatches as you add more. Pick a section tab and get a table with a column
  per instance, status chips (in sync / drift / missing / state mismatch /
  inactive), the store-app "↑ update" signal, an optional dates column, search +
  status filters, and **Export CSV**.

- **Richer metadata fields in the export.** The exporter metadata sections now
  carry more of their source-table columns for cross-instance comparison:
  store apps gain `latestVersion`, `updateAvailable`, `installDate`, and
  `updateDate` (the "update available" signal); plugins gain `installDate`; and
  custom apps gain install/update dates (from `sys_created_on` / `sys_updated_on`).
  Both the Node and background exporters emit them, and the Configuration Data
  CSV includes them. Dates are display-only context — they never count as
  "drift" (they always differ across instances).

- **Configuration Data reconcile logic** (internal foundation,
  [#103](https://github.com/revampd/sn-schema-explorer/issues/103)). New
  `modules/config-data/reconcile.js` does N-way reconciliation of a metadata
  section (plugins / store apps / custom apps / properties) across registered
  instances — union of entries, per-instance cells, and a status
  (`sync` / `drift` / `missing` / `active` / `inactive`) — plus a CSV export
  serialiser. Pure logic, fully unit-tested; the comparison UI follows in a later
  PR.

- **Shared theming tokens + utilities** adapted from the cross-instance
  reconciler — radius/shadow/glass CSS variables plus reusable `.glass`,
  `.eyebrow`, and `.pill-badge` classes in `base.css`. Refreshes the landing
  page (translucent "glass" instance cards, a monospace eyebrow heading, and
  per-section status dots) and the Schema Diff summary (glass stat tiles),
  aligning them with the app's existing glass canvas panels. Still
  fully self-contained — no web fonts or external resources (the system-font
  stack is unchanged).

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
- **Workspace controller** (internal structural seam,
  [#100](https://github.com/revampd/sn-schema-explorer/issues/100)). New
  `engine/workspace.js` adds a workspace layer (`landing` / `schema-explorer` /
  `config-data`) that is a sibling of the graph view-mode, plus empty
  landing + Configuration Data regions.
- **Landing page front door**
  ([#101](https://github.com/revampd/sn-schema-explorer/issues/101)). The app now
  opens on a landing page where you **register one or more instance exports** as a
  grid of **instance cards** (plus an **Add instance** card). Each card shows the
  sections present in that export (Schema / Plugins / Store apps / Custom apps /
  Properties, with counts) and a row of **per-instance tool icons** — open the
  **Schema Explorer** on that instance directly from its card. Multi-instance
  tools launch from a card with that instance as the base and let you add others
  from inside the tool (the Schema Diff base/compare pattern). A **Home** button
  in the header returns to the landing page. File-drop, demo load, and multi-part
  manifest stitching moved from the load overlay into the landing page; loading a
  file registers an instance rather than entering a tool directly. The landing
  page (and other non–Schema-Explorer workspaces) present a clean shell — the
  graph sidebars, canvas, minimap, and graph-only header controls are hidden,
  leaving the brand plus Guide / Settings.

- **Schema Diff consumes the instance registry**
  ([#102](https://github.com/revampd/sn-schema-explorer/issues/102)). Schema Diff
  no longer has its own file upload. Launch it from an instance card's **⇄** icon
  (with that instance as the base), then pick the **Compare** instance from a
  dropdown in the diff sidebar — the Base/Compare both come from the registered
  instances. The compare export is cloned before diffing so the stored instance
  is never mutated. The Diff card icon enables only when Schema Diff is on and at
  least two schema-capable instances are registered.

- **Instance Data tab in Configuration Data**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). The
  Configuration Data workspace gains an **Instance Data** tab (always present
  when ≥1 instance is registered) that compares instance identity, runtime, and
  export metadata plus a schema-stats table across the registered instances —
  one aligned table with a column per instance, base-vs-compare colouring and
  inline deltas on the stat rows. Un-loaded (restored) instances still show their
  identity/runtime from persisted metadata. The single-instance footer pill modal
  now shares the same renderers.

- **Instance picker in Configuration Data**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). A chip row
  above the section tabs lets you choose which registered instances to compare
  (shown when more than one is registered); the selection drives every tab,
  including Instance Data.

- **Configure the background script before copying**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). The setup
  instructions gain a small form that rewrites the background exporter's `CONFIG`
  block in place — output format, per-table record counts, print-to-output,
  property values, metadata sections, and edge types — so you copy a
  ready-configured script. The script remains the single source of truth (only
  the known fields are rewritten).

- **Instance cards show a build · export-time subtitle**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). Because the
  same instance can be exported more than once (e.g. pre/post upgrade), each
  landing card now shows the build name and export timestamp so duplicate
  instances are distinguishable.

### Changed

- **Instance cards redesigned**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). The card
  body now shows the instance URL, a prominent release-name badge (e.g.
  "Australia"), and a clean export-date line instead of the five separate
  section-status rows. Section counts collapse into a compact two-row grid
  (abbreviated labels over bold numbers). Tool icons move to a footer row with a
  top-border separator; rename and delete stay in the header.
- **About chip replaces footer credits + update badge**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). The footer
  right now shows a single always-visible `v1.x.x` version chip. Clicking it opens
  an About modal (same style as the instance info popup) with the version, update
  status, GitHub link, "Built with Claude", and MIT copyright. When a newer release
  is detected the chip changes to "New version available" (accent colour) and the
  modal links directly to the release.
- **"Cross-instance comparison" eyebrow heading removed** from the Configuration
  Data workspace. The tool shows instance configuration data; comparison is a
  secondary feature, not the primary framing.
- **Carrier-count badges removed from Configuration Data section tabs.** The
  number of instances carrying a section added noise without aiding navigation;
  the tooltip still states the count when available.
- **All checkboxes migrated to toggle switches; all selects unified**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). Every
  checkbox in the app (edge-legend, Show dates, bg-script config options, metadata
  section and edge-type pickers) is now a consistent iOS-style `.sn-toggle` switch.
  Every `<select>` (Config Data filter, bg-script format, Schema Diff
  base/compare, advanced-filter edge type) uses a single shared `.sn-select`
  style. The bespoke per-module toggle and select CSS is removed.
- The front door is now the landing page rather than a load overlay; the graph
  loads when you open an instance in a tool.
- Schema Diff's compare schema is now chosen from the registry instead of a
  separate drag-and-drop upload.
- Both exporters now read the active-plugin count from `sys_plugins`
  (`active=true`) instead of `v_plugin` (`active=active`), retiring `v_plugin`
  from the exporter.
- **Instance rename is now inline** — no browser `prompt()` popup. Clicking the
  ✎ on an instance card turns its title into an editable field (Enter or blur to
  commit, Escape to cancel).
- **Unified scrollbar theming.** A single global scrollbar theme (tokens in
  `base.css`) now styles every scrollable surface, so new features get a
  consistent themed scrollbar automatically; the ~12 per-component scrollbar
  rules were removed (intentionally hidden tab bars and the wasabi autocomplete
  dropdown are kept as explicit overrides).
- **Source tree restructured (internal, no behaviour change).** Flattened
  `src/viewer/` away into `src/core/` (the shared platform — former
  `core`+`engine`+`shared`), `src/modules/<feature>/` (self-contained features),
  and `src/app/` (`shell.html`, the single `main.js` entry, `app.meta.js`, global
  `styles/`); the exporters moved to `src/exporters/`. Each module now ships a
  `module.meta.js` and `build.js` self-assembles the CSS cascade, HTML partials,
  guide tabs, and the app-entry import graph from those manifests — adding a
  feature is dropping a folder with `index.js` + `module.meta.js`. The
  `entries/lite.js`+`full.js` split collapsed into one `src/app/main.js`. The
  built `dist/` is byte-identical (modulo file-path comments in the bundle).
  Unit tests now mirror the `src/` tree under `tests/`.

### Changed

- **Schema Diff sidebar simplified**
  ([#126](https://github.com/revampd/sn-schema-explorer/issues/126)). Removed the
  inline "Filter tables…" search from the diff sidebar — the header search bar
  (Tbl mode) already filters the diff list — and hid the Application Scopes panel
  and the main table-list **sort bar** while in Diff view, where they aren't
  relevant (Diff has its own grouped Added/Removed/Changed list). All three were
  also inconsistently re-appearing after a base switch (a `loadGraph` re-show);
  they now stay hidden in Diff.

### Fixed

- **Advanced filter edge-type dropdown was clipped / unusable**
  ([#126](https://github.com/revampd/sn-schema-explorer/issues/126)). The
  migrated "Has Edge" dropdown opened inside the filter bar's `overflow: hidden`
  row, so its option list was clipped and effectively invisible. The custom
  dropdown's menu is now portalled to `<body>` with `position: fixed` (anchored
  to the button, repositioned on scroll/resize), so it escapes clipping or
  transformed ancestors anywhere it's used.
- **Schema Diff: swapping/switching base corrupted the comparison (Added/Removed
  read 0)** ([#126](https://github.com/revampd/sn-schema-explorer/issues/126)).
  The base graph aliases the instance's in-memory data, and the diff grafts the
  compare's added nodes into it in place. Switching the base (e.g. via the swap
  button) didn't ungraft the **outgoing** base first, so its data kept the
  compare's phantom nodes — and reusing that instance as the new compare made
  "Added" and "Removed" collapse to 0 and inflated "Changed". The outgoing base
  is now ungrafted before any base switch, so a swap correctly inverts the diff.
- **Configuration Data: plugins compared as all "missing"**
  ([#126](https://github.com/revampd/sn-schema-explorer/issues/126)). The Plugins
  tab keyed each plugin on its `id`, but the exporter falls back to the plugin
  record's **sys_id** when the `id` column is empty — and sys_ids differ across
  instances. The same plugin therefore reconciled as two separate "missing" rows.
  Plugins are now keyed on their **name** (the stable `@scope/plugin` source id),
  so a plugin present on both instances reconciles to a single row that reflects
  its true in-sync / drift status.
- **Configuration Data: trailing instance columns scrolled off-screen**
  ([#126](https://github.com/revampd/sn-schema-explorer/issues/126)). On the
  Properties tab (and any section), a long unbreakable property name or value
  forced the comparison table wider than its container, pushing the second (and
  later) instance columns and the Status column out of view — making a two-way
  comparison look like a single column. Names/keys now wrap and long values are
  ellipsis-truncated (full value on hover), so every instance column stays
  visible.
- **Re-importing the same schema file did nothing**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). The landing
  file input never reset its value, so re-selecting the same filename (e.g. after
  deleting that instance) didn't fire a `change` event. The input now resets after
  each selection.
- **Key column dropped from Plugins, Store apps, and Custom apps tabs**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). Sys IDs
  (plugins) and scopes (store/custom apps) differ across instances by definition
  and add no comparison value, so the Key column is now hidden for those sections.
  Properties already hid it (key === name); that behaviour is unchanged.
- **Properties tab showed redundant identical Name + Key columns**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). Properties
  are keyed and named by the same field, so the duplicate Key column added noise
  and pushed the value column off-screen. The Key column is now dropped when it
  would duplicate Name (properties only; plugins/store apps/custom apps keep it).
- **Landing setup instructions required two unfolds and didn't span the divider**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). A redundant
  inner accordion was removed (the section now expands in one click) and the
  panel stretches to full width.
- **Background-script exporter failed to compile in ServiceNow** with
  `invalid property id` ([#120](https://github.com/revampd/sn-schema-explorer/issues/120)).
  The bg script runs under Rhino at ES Level 0 (ES3), which forbids future-reserved
  words (`float`, `boolean`) as unquoted object-literal keys. The `BG_TYPE_LABELS`
  and `BG_TYPE_XSD` lookup tables now quote those keys (pinned with `// prettier-ignore`
  so formatting can't strip them back off). ES5 tooling parsed it fine, so only
  ES3-mode Rhino surfaced the error.

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
