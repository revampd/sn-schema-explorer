# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.4] - 2026-06-30

### Performance

- **Background exporter is ~51% faster on large instances.** The exporter no longer
  calls `getRefRecord()` on every reference field in `sys_dictionary` — an ES5/Rhino
  method that issues a separate GlideRecord query per call. Instead, `sys_db_object`
  is fetched once up front and all name lookups are resolved from two in-memory maps
  (by sys_id and by name). On a 9 356-table instance this cut wall-clock time from
  378 s to 185 s while producing byte-for-byte identical output (42 676 reference
  edges, 203 811 fields). The dual-map approach also fixes a regression introduced
  earlier in the same branch where references dropped to 0 on real instances due to
  Java String / JS string key coercion differences in Rhino.

### Added

- **Freeze Viewport.** A **⊘** button in the zoom-controls group (right edge of the
  canvas) and its keyboard shortcut **Shift+L** lock the graph so that clicking a
  node updates only the Inspector — the neighbourhood, visible set, node positions,
  and layout are untouched. Panning and scroll-zoom still work normally; node dragging
  (which reheats the force simulation) is blocked. Clicking empty canvas space no
  longer deselects while frozen. Press **Shift+L** or click the button again to
  unfreeze. The button highlights in accent colour while active.

### Changed

- **Path Finder, Schema Diff, Configuration Data, and Advanced Path Finder
  configuration are now always enabled** — the feature toggles have been removed from
  Settings. All four are baseline features; any previously-saved "disabled" preference
  is ignored. Settings → Features now shows only Saved Views.
- **Max PNG Scale removed from Settings.** The export resolution ceiling is now derived
  automatically from the browser's detected canvas size limit (16 MP → 50×, 64 MP+ →
  200×). The underlying setting is still respected if written to localStorage manually.
- **Output format label standardised to "Schema Explorer format"** across the export
  wizard (bg script and Node.js options) for consistency.
- **Node.js minimum raised to 22** for the standalone Node exporter and dev toolchain.
  Dev dependencies updated across the board.

## [1.0.3] - 2026-06-30

### Performance

- **Selecting a compare schema is faster.** The Differences sidebar was built
  twice on every compare selection — now built once. The element-kind set
  powering the **Kind** chips is also memoized per comparison instead of
  rescanning the whole diff on every summary refresh.
- **Large diffs no longer build tens of thousands of sidebar rows up front.** A
  diff group larger than 200 tables now starts collapsed (rows built lazily on
  expand), and an expanded group renders at most 200 rows with a "+N more" footer.
  Narrow with the header search, the Kind filter, or the advanced filter to see
  specific tables.

### Added

- **Added/Removed tables now list their relationships in the diff report.** A
  newly-added table shows the relationships it introduces (and a removed table the
  ones that vanish with it) as a **Relationships** sub-group under the table row —
  the same edge rows that changed tables already show, clickable to navigate to
  the related table.
- **Filter the diff report by element type.** A row of **Kind** toggle chips in
  the Differences sidebar slices the **Added, Removed, and Changed** tables to
  those that touch a highlighted element kind — Fields, References, Inheritance,
  M2M, Named relationship, DB view, or CI topology. Click a chip to toggle that
  kind; an **All** chip restores every kind. All three summary counts show the
  sliced total as `passing/total`. Only the kinds actually present in the current
  comparison get a chip, and the relationship sub-rows under each table are
  filtered to the highlighted kinds too.
- **Export the active comparison/diff from the Schema Map**
  ([#177](https://github.com/revampd/sn-schema-explorer/issues/177)). When a
  comparison is active, the export bar's data row gains comparison controls: an
  **Include comparison** toggle that folds the diff into the Full / Neighbourhood
  schema export (embedded — a `comparison` block in JSON, a "Differences" section
  in Markdown, `sn:comparison` in JSON-LD, a comment block in OWL/Turtle, and an
  `x-comparison` extension in OpenAPI), and a new **Comparison** scope that
  exports _only_ the diff in any of the five formats. A **multi-select** lists the
  active compares so you choose which diff sets are included. All of it is opt-in
  and appears only while comparing. PNG/SVG image exports carry the on-canvas diff
  colouring, and the **Legend** toggle (renamed from "Edge legend") now also draws
  a **Differences** key (Added / Removed / Changed) into the image while a
  comparison is active.
- **Multi-select Compare (compare against several instances at once)**
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150)). The header
  **Compare** control is now multi-select: it's a single dropdown whose rows are
  toggles — a ✓ marks the instances currently in the comparison, and the button
  summarises the selection ("vs prod", "Compare: 3 instances"). Selecting more
  than one lights up the N-column inspector and the N-column sidebar roll-up.
  "Compare: none" clears all; the **swap (⇄)** flips Base with the primary
  compare; any additional compares ride along. The canvas keeps its pairwise
  colouring against the primary compare.
- **N-column change-report sidebar**
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150),
  [#149](https://github.com/revampd/sn-schema-explorer/issues/149)). When more
  than one compare is loaded, the diff sidebar list switches from the pairwise
  Added / Removed / Changed grouping to an **N-column roll-up**: one row per
  table that differs in at least one instance, each with a per-instance status
  strip (a chip per compare, coloured by that table's status there). The summary
  counts become "added / removed / changed in at least one instance". A single
  compare keeps the classic grouped list unchanged.
- **Unified N-column comparison inspector**
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150)). While a
  comparison is active, the inspector is now a **matrix that scales from one
  compare to many** — one column per instance (Base + each compare), with a
  per-instance status strip, a field matrix (each field coloured per column vs
  Base: added / removed / type-changed), relationship changes grouped per compare,
  and per-compare configuration drift. With a single compare it reads like the
  classic Base | Compare diff; with several it grows columns. When the focused
  table is identical across every compare (and has no config drift) the rich
  single-table inspector renders instead — single-instance detail is unchanged.
- **Config drift in the Schema Diff inspector**
  ([#139](https://github.com/revampd/sn-schema-explorer/issues/139)). When
  comparing two instances, selecting a table now shows a **Configuration** section
  in the inspector — the owning application, its version/active on **each side**
  (base vs compare), and the drift status — beside the existing field- and
  relationship-level diff. A structurally-identical table whose app drifted is now
  also inspectable. A small corner **badge** marks drifted nodes on the canvas.
  Config is **opt-in**: appears only when **both** instances exported store/custom
  app metadata.
- **Unified comparison context**
  ([#138](https://github.com/revampd/sn-schema-explorer/issues/138)). One shared
  "compare against" selection across Schema Diff and the config-drift layer —
  both read and write the same `focusState.compareId`, so switching context in one
  tool is immediately reflected in the other.
- **Config drift on the Schema Map**
  ([#133](https://github.com/revampd/sn-schema-explorer/issues/133)). A toggleable
  **layer** that tints schema-map tables by the **configuration drift** of the
  application that owns their scope, across your registered instances. A small
  canvas control turns it on (off by default) and shows a legend — in sync / drift
  / missing / state mismatch — using the **same** classification as the
  Configuration Data table. Covers store + custom apps; needs **≥2** app-capable
  instances (the control hides otherwise).
- **Shared entity spine**
  ([#132](https://github.com/revampd/sn-schema-explorer/issues/132)). A pure
  addressing layer that joins the Structure lens (schema nodes) to the Config lens
  (store / custom apps) by application **scope**, so any lens can resolve "what
  does Config know about this table?" as a lookup. Powers the config-drift overlay
  and the inspector's Configuration section.
- **Shared focus across lenses**
  ([#131](https://github.com/revampd/sn-schema-explorer/issues/131)). A thin
  facade — `focusState` (`instanceId` / `compareId` / `table`) plus an
  `onFocusChange` event — giving the tools one shared notion of "what the user is
  looking at". The table you have selected in Schema Map now **carries into Path
  Finder's source** when you switch lenses.
- **Header tool switcher + instance dropdown**
  ([#127](https://github.com/revampd/sn-schema-explorer/issues/127)). The header
  is reorganised around an always-visible **tool switcher** that replaces the old
  `Schema Map | Path Finder | Diff` segment — it lists every tool available for
  the loaded instance and works from any of them, so you can move between tools
  without going Home. A new **instance dropdown** sits beside it: it switches the
  loaded instance in Schema Map / Path Finder, and in Schema Diff it sets the
  **Base**. The Home button is now text-only, and **Path Finder** is also
  launchable from an instance card. A **⇄** button between Base and Compare
  flips the two sides in place.
- **App-themed dropdowns everywhere**
  ([#126](https://github.com/revampd/sn-schema-explorer/issues/126)). A custom
  dropdown replacing all native `<select>`s — keyboard-accessible (arrows,
  Home/End, Enter/Space, Escape) and ARIA listbox-labelled. Used for the Schema
  Diff Base/Compare pickers, the Configuration Data status filter, the advanced
  filter's edge-type picker, and the background-script "Output format" picker.
- **Configuration Data: Export JSON**
  ([#126](https://github.com/revampd/sn-schema-explorer/issues/126)). Alongside
  Export CSV, the comparison view can now export the current section as JSON — the
  section, compared instances, comparable fields, status counts, and one entry per
  key with a per-instance cell — for feeding the reconciliation into other tooling.
- **Configuration Data tool**
  ([#104](https://github.com/revampd/sn-schema-explorer/issues/104)). A new
  workspace that views and reconciles a metadata section — **plugins, store apps,
  custom apps, or system properties** — across the instances you've registered.
  Launch it from an instance card's **▦** icon (enable Configuration Data in
  Settings first). Pick a section tab and get a table with a column per instance,
  status chips (in sync / drift / missing / state mismatch / inactive), the
  store-app "↑ update" signal, an optional dates column, and search + status
  filters.
- **Richer metadata fields in the export.** Store apps gain `latestVersion`,
  `updateAvailable`, `installDate`, and `updateDate`; plugins gain `installDate`;
  custom apps gain install/update dates (from `sys_created_on` / `sys_updated_on`).
  Both exporters emit them; the Configuration Data CSV includes them. Dates are
  display-only — they never count as "drift".
- **Configuration Data reconcile logic** (internal foundation,
  [#103](https://github.com/revampd/sn-schema-explorer/issues/103)). N-way
  reconciliation of a metadata section across registered instances — union of
  entries, per-instance cells, and a status (`sync` / `drift` / `missing` /
  `active` / `inactive`) — plus a CSV export serialiser. Pure logic, fully
  unit-tested.
- **Shared theming tokens + utilities** — radius/shadow/glass CSS variables plus
  reusable `.glass`, `.eyebrow`, and `.pill-badge` classes. Refreshes the landing
  page (translucent "glass" instance cards) and the Schema Diff summary (glass
  stat tiles). Still fully self-contained — no web fonts or external resources.
- **Cross-instance metadata sections in the export**
  ([#97](https://github.com/revampd/sn-schema-explorer/issues/97)). The Node
  extractor gains `--metadata=plugins,storeApps,customApps,properties` (env
  `SN_METADATA`) to emit an opt-in top-level `_metadata` block with
  `_capabilities.metadata.<section>` flags. `sys_properties` **values are off by
  default**; `--include-property-values` opts in, gated by a central denylist.
  `--property-query` (env `SN_PROPERTY_QUERY`) narrows which properties export.
  Metadata is JSON-only.
- **Background-script support for the same metadata sections**
  ([#98](https://github.com/revampd/sn-schema-explorer/issues/98)). The bg script
  gains `CONFIG.metadataSections`, `includePropertyValues`, `propertyValueDenylist`,
  and `propertyEncodedQuery`, with flat GlideRecord fetchers producing the same
  shape as the Node extractor.
- **Multi-instance registry state** (internal foundation,
  [#99](https://github.com/revampd/sn-schema-explorer/issues/99)). New
  `core/instances-state.js` holds registered instances with presence-based
  capability detection and list-only persistence (`snse:instances:v1`).
- **Workspace controller** (internal structural seam,
  [#100](https://github.com/revampd/sn-schema-explorer/issues/100)). Adds a
  workspace layer (`landing` / `schema-explorer` / `config-data`) as a sibling of
  the graph view-mode, with empty landing + Configuration Data regions.
- **Landing page front door**
  ([#101](https://github.com/revampd/sn-schema-explorer/issues/101)). The app now
  opens on a landing page where you **register one or more instance exports** as a
  grid of **instance cards**. Each card shows the sections present in that export
  and a row of **per-instance tool icons**. A **Home** button in the header returns
  to the landing page. Loading a file registers an instance rather than entering a
  tool directly.
- **Schema Diff consumes the instance registry**
  ([#102](https://github.com/revampd/sn-schema-explorer/issues/102)). Schema Diff
  no longer has its own file upload — launch it from an instance card's **⇄** icon,
  then pick the **Compare** instance from a dropdown in the diff sidebar. The Diff
  card icon enables only when Schema Diff is on and at least two schema-capable
  instances are registered.
- **Instance Data tab in Configuration Data**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). Compares
  instance identity, runtime, and export metadata across the registered instances
  — one aligned table with a column per instance, base-vs-compare colouring and
  inline deltas on the stat rows.
- **Instance picker in Configuration Data**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). A chip row
  above the section tabs lets you choose which registered instances to compare
  (shown when more than one is registered); the selection drives every tab.
- **Configure the background script before copying**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). The setup
  instructions gain a small form that rewrites the background exporter's `CONFIG`
  block in place — output format, per-table record counts, property values,
  metadata sections, and edge types — so you copy a ready-configured script.
  Metadata sections default to all-on. Three additional fields are conditionally
  shown: a **count exclude pattern** list (when record counts are on), a
  **property encoded query** filter (when Properties is enabled), and a **property
  denylist** regex (when "Include property values" is on). The "Also print JSON to
  script output" option is removed — the attachment download supersedes it.
- **Instance cards show a build · export-time subtitle**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). Each
  landing card shows the build name and export timestamp so duplicate instances
  (e.g. pre/post upgrade) are distinguishable.

### Changed

- **Schema Diff is now a layer on the Schema Map, not a separate view**
  ([#141](https://github.com/revampd/sn-schema-explorer/issues/141)). Comparison
  is no longer a mode you switch into — you stay on the map and pick a **Compare**
  instance from the header dropdown. The structural diff (added/removed/changed
  colouring, edge pills, the rich field/relationship inspector, and the
  change-report sidebar) activates **on the map**. Switching the loaded instance
  re-runs the comparison against the new base; clearing the Compare dropdown
  returns to the plain map. The separate "Diff" view-mode is gone. Base, Compare,
  and a **swap (⇄)** control all live in the header; the old diff sidebar
  Base/Swap/Compare section is removed.
- **The diff overlay is always on while comparing — no canvas toggle.** Selecting
  one or more compares simply paints the structural diff on the Schema Map;
  there's no layer to turn on or off. Configuration drift is surfaced in the
  Inspector (the Configuration section for the selected table) and the Config Data
  table — not as a canvas channel.
- **Diff report is structure-only, with collapsible groups and a clearer graph
  toggle.** Configuration drift no longer appears in the Differences sidebar —
  it lives in the **Inspector** and the Config Data table, where it's actionable.
  The report lists table changes only; Added / Removed / Changed counts are
  table-only. Each group collapses on click. The old "Show all / Changed only"
  control is clarified to **Graph: all tables / Graph: changed only** — it only
  ever affected which tables are drawn on the canvas.
- **Configuration Data uses the header Base + Compare controls.** The Config
  workspace's in-workspace instance chip picker is gone; instead the header
  instance dropdown picks the **base** column and the header **Compare**
  multi-select picks the other columns. The header Compare control + swap button
  are extracted into a shared, provider-driven `core/header-compare.js` that both
  Schema Diff and Config Data register into.
- **Removed the redundant "Compare on the Schema Map" landing card.** Comparison
  is now driven entirely from the header **Compare** control.
- **Background exporter splits at 5 MB (was 10 MB).** The ServiceNow background
  script now writes a single attachment only up to 5 MB and switches to the
  multi-part (manifest + parts) format above that, with each part capped at 5 MB.
  Lowers peak in-memory string size in the Rhino sandbox; the viewer auto-stitches
  multi-part exports on load.
- **The Export bar is now view-aware and surfaces in every tool.** The **Schema
  Map** keeps its data row (JSON / Markdown / JSON-LD / OWL-Turtle / OpenAPI) plus
  image row (PNG / SVG); **Path Finder** shows image exports only; and
  **Configuration Data** gains a CSV / JSON row that names the active section and
  disables when there's nothing tabular to export. The inline Export buttons that
  used to sit in the Configuration Data controls have moved into this shared bar.
- **Comparison inspector layout matches the single-instance inspector**
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150)). The diff
  inspector now opens with a **Properties** section (scope / core / children /
  records, column-aware, differences highlighted) like the single view, and its
  section headers use the same uppercase, underlined style.
- **Relationships in the comparison inspector are now an N-column matrix**
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150)). Relationship
  changes render as one row per related table (with the friendly legend label —
  Reference to / Referenced by / Child tables / M2M junction / Named relationship /
  DB view member / CI topology) and a present/absent cell per instance, coloured
  added / removed vs Base. The inspector is also **inheritance-complete for
  relationships**: relationships inherited from parent tables are included (tagged
  `inherited`).
- **Schema Diff sidebar simplified**
  ([#126](https://github.com/revampd/sn-schema-explorer/issues/126)). Removed the
  inline "Filter tables…" search from the diff sidebar — the header search bar
  already filters the diff list — and hid the Application Scopes panel and the
  main table-list **sort bar** while in Diff view.
- **Instance cards redesigned**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). The card
  body now shows the instance URL, a prominent release-name badge, and a clean
  export-date line. Section counts collapse into a compact two-row grid. Tool
  icons move to a footer row; rename and delete stay in the header.
- **About chip replaces footer credits + update badge**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). The footer
  shows a single always-visible `v1.x.x` version chip. Clicking it opens an About
  modal with version, update status, GitHub link, and MIT copyright. When a newer
  release is detected the chip changes to "New version available".
- **All checkboxes migrated to toggle switches; all selects unified**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). Every
  checkbox in the app is now a consistent iOS-style `.sn-toggle` switch. Every
  `<select>` uses a single shared `.sn-select` style.
- **Unified scrollbar theming.** A single global scrollbar theme styles every
  scrollable surface; the ~12 per-component scrollbar rules were removed.
- **Instance rename is now inline** — no browser `prompt()` popup. Clicking ✎ on
  an instance card turns its title into an editable field (Enter or blur to
  commit, Escape to cancel).
- Both exporters now read the active-plugin count from `sys_plugins`
  (`active=true`) instead of `v_plugin`, retiring `v_plugin` from the exporter.
- **Source tree restructured (internal, no behaviour change).** Flattened
  `src/viewer/` into `src/core/` (shared platform), `src/modules/<feature>/`
  (self-contained features), and `src/app/` (entry + shell + global styles);
  exporters moved to `src/exporters/`. Each module ships a `module.meta.js` and
  `build.js` self-assembles from those manifests. Unit tests now mirror the `src/`
  tree under `tests/`.
- **"Cross-instance comparison" eyebrow heading removed** from the Configuration
  Data workspace.
- **Carrier-count badges removed from Configuration Data section tabs.** The
  tooltip still states the count when available.

### Fixed

- **The diff "Kind" summary counts now track the slice and re-render on change.**
  Each badge shows the sliced total as `passing/total` and updates on every Kind
  change.
- **The diff "Kind" filter no longer clips its labels.** The open menu was pinned
  to the trigger-button width, truncating labels like "References" to "R…". It
  now widens to fit.
- **The comparison inspector no longer shows a compare-only table as "identical"
  in the base.** The inspector strips `_diffOnly` graft artifacts from the base
  column, so an added table's fields, properties, and references correctly show as
  **added** (base column shows "—").
- **Configuration Data and the Schema Map share one comparison selection.** Config
  Data now opens with the compare set to **none**; switching to the Schema Map
  loads the selected instance's graph; and a compare selection made in Config Data
  carries to the Schema Map (and back).
- **The Application Scope filter is usable on instances with many scopes.** The
  scope-pill list is now capped in height and scrolls instead of growing to fill
  the whole viewport.
- **The Inspector no longer crashes on a field without a label.** Field sorting
  now guards against a missing `label`.
- **Starting a comparison no longer collapses the Schema Map.** A new comparison
  shows the full graph with diff colouring by default. The **Changed only** toggle
  still narrows it on demand.
- **Diff sidebar rows for compare-only tables are now clickable**
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150)). Selecting
  such a row opens the comparison inspector even though the table isn't drawn on
  the map.
- **Comparison inspector now reads like the single-instance inspector**
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150)). Relationship
  changes are grouped by Added / Removed with the friendly relationship type shown
  inline. The inspector is now fully **inheritance-aware**: it shows a table's
  effective schema (own + inherited, tagged `inherited`) and flags a table whose
  only difference is inherited. An **identical** column now reads **green** ("in
  sync"), not amber.
- **The Compare control and swap (⇄) button now hide together** when fewer than
  two schema instances are registered.
- **An instance can no longer compare against itself.** Switching the Base onto
  an already-selected compare removes that compare (clearing the comparison if it
  was the only one).
- **Schema Diff no longer leaks compare-only tables into the Schema Map.** Leaving
  Diff view now un-grafts those nodes/edges; returning re-grafts them.
- **Advanced filter edge-type dropdown was clipped / unusable**
  ([#126](https://github.com/revampd/sn-schema-explorer/issues/126)). The custom
  dropdown's menu is now portalled to `<body>` with `position: fixed`, so it
  escapes clipping or transformed ancestors anywhere it's used.
- **Schema Diff: swapping/switching base corrupted the comparison (Added/Removed
  read 0)** ([#126](https://github.com/revampd/sn-schema-explorer/issues/126)).
  The outgoing base is now ungrafted before any base switch, so a swap correctly
  inverts the diff.
- **Configuration Data: plugins compared as all "missing"**
  ([#126](https://github.com/revampd/sn-schema-explorer/issues/126)). Plugins are
  now keyed on their **name** (the stable `@scope/plugin` source id) instead of
  sys_id, which differs across instances.
- **Configuration Data: trailing instance columns scrolled off-screen**
  ([#126](https://github.com/revampd/sn-schema-explorer/issues/126)). Names/keys
  now wrap and long values are ellipsis-truncated (full value on hover), so every
  instance column stays visible.
- **Re-importing the same schema file did nothing**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). The file
  input now resets after each selection so re-selecting the same file fires
  `change`.
- **Key column dropped from Plugins, Store apps, and Custom apps tabs**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). Sys IDs and
  scopes differ across instances by definition; the Key column is now hidden for
  those sections.
- **Properties tab showed redundant identical Name + Key columns**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). The Key
  column is now dropped when it would duplicate Name.
- **Landing setup instructions required two unfolds and didn't span the divider**
  ([#123](https://github.com/revampd/sn-schema-explorer/issues/123)). A redundant
  inner accordion was removed; the panel stretches to full width.
- **Background-script exporter failed to compile in ServiceNow** with
  `invalid property id` ([#120](https://github.com/revampd/sn-schema-explorer/issues/120)).
  ES3-reserved words (`float`, `boolean`) are now quoted as object-literal keys
  (pinned with `// prettier-ignore` so formatting can't strip them off).

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

[Unreleased]: https://github.com/revampd/sn-schema-explorer/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/revampd/sn-schema-explorer/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/revampd/sn-schema-explorer/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/revampd/sn-schema-explorer/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/revampd/sn-schema-explorer/releases/tag/v1.0.0
