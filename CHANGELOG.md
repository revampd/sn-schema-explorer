# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Export the active comparison/diff from the Schema Map**
  ([#177](https://github.com/revampd/sn-schema-explorer/issues/177)). When a
  comparison is active, the export bar's data row gains comparison controls: an
  **Include comparison** toggle that folds the diff into the Full / Neighbourhood
  schema export (embedded — a `comparison` block in JSON, a "Differences" section
  in Markdown, `sn:comparison` in JSON-LD, a comment block in OWL/Turtle, and an
  `x-comparison` extension in OpenAPI), and a new **Comparison** scope that exports
  _only_ the diff in any of the five formats. A **multi-select** lists the active
  compares so you choose which diff sets are included. All of it is opt-in and
  appears only while comparing — the plain schema export is unchanged otherwise.
  PNG/SVG image exports carry the on-canvas diff colouring, and the **Legend**
  toggle (renamed from "Edge legend") now also draws a **Differences** key
  (Added / Removed / Changed) into the image while a comparison is active.
- **Multi-select Compare (compare against several instances at once)**
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150)). The header
  **Compare** control is now multi-select: it's a single dropdown whose rows are
  toggles — a ✓ marks the instances currently in the comparison, and the button
  summarises the selection ("vs prod", "Compare: 3 instances"). Selecting more
  than one lights up the N-column inspector and the N-column sidebar roll-up —
  comparing the loaded schema against many instances at once on the Schema Map.
  "Compare: none" clears all; the **swap (⇄)** flips Base with the primary
  compare (the first selected) and any additional compares ride along. The
  canvas keeps its pairwise colouring against the primary compare.
- **N-column change-report sidebar**
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150),
  [#149](https://github.com/revampd/sn-schema-explorer/issues/149)). When more
  than one compare is loaded, the diff sidebar list switches from the pairwise
  Added / Removed / Changed grouping to an **N-column roll-up**: one row per
  table that differs in at least one instance, each with a per-instance status
  strip (a chip per compare, coloured by that table's status there). The summary
  counts become "added / removed / changed in at least one instance". A single
  compare keeps the classic grouped list and counts unchanged. Rows keep their
  click + keyboard navigation.
- **Unified N-column comparison inspector**
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150)). While a
  comparison is active, the inspector is now a **matrix that scales from one
  compare to many** — one column per instance (Base + each compare), with a
  per-instance status strip, a field matrix (each field coloured per column vs
  Base: added / removed / type-changed), relationship changes grouped per
  compare, and per-compare configuration drift. With a single compare it reads
  like the classic Base | Compare diff; with several it grows columns. When the
  focused table is identical across every compare (and has no config drift) the
  rich single-table inspector renders instead — single-instance detail is
  unchanged. (The multi-select Compare control that feeds more than one compare
  lands in a follow-up PR; the renderer is already N-column.)
- **N-way comparison seam — internal groundwork**
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150); the
  [#130](https://github.com/revampd/sn-schema-explorer/issues/130) "integrated
  lenses" epic). The comparison state now carries an ordered list of compare
  instances (`_compareIds`, primary first) and a per-subject **diff matrix**
  (`_diffMatrix` — one pairwise diff per compare, built via `computeDiffMatrix`),
  alongside a `rollupMatrix` aggregator. The single-compare picker still drives
  everything today, so there is no visible change yet; this is the foundation for
  the upcoming N-column inspector, N-column change-report sidebar, and
  multi-select Compare control. The canvas/graft path stays keyed to the
  **primary** compare (`_diffData` === `_diffMatrix[0]`).

### Changed

- **Background exporter splits at 5 MB (was 10 MB).** The ServiceNow background
  script now writes a single attachment only up to 5 MB and switches to the
  multi-part (manifest + parts) format above that, with each part capped at
  5 MB. This keeps a single attachment from truncating in the script output
  panel and lowers peak in-memory string size in the Rhino sandbox. The viewer
  auto-stitches multi-part exports on load, so there's no change to how you load
  them.
- **The Export bar is now view-aware and surfaces in every tool.** The header
  **Export** button opens an export bar trimmed to what each workspace can
  actually export: the **Schema Map** keeps its data row (JSON / Markdown /
  JSON-LD / OWL-Turtle / OpenAPI) plus image row (PNG / SVG); **Path Finder**
  shows image exports only, scoped to the current view (no data formats, no
  full-canvas image scope, since the DAG has no full-schema export); and
  **Configuration Data** gains a CSV / JSON row that names the active section
  ("Export Plugins as …") and disables with a hint when there's nothing tabular
  to export (the Instance Data tab, or an empty result). The inline **Export
  CSV / Export JSON** buttons that used to sit in the Configuration Data controls
  have moved into this shared bar, so export lives in one place across the app.
- **Comparison inspector layout matches the single-instance inspector**
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150)). The diff
  inspector now opens with a **Properties** section (scope / core / children /
  records, column-aware, differences highlighted) like the single view, and its
  section headers use the same uppercase, underlined style — so switching between
  a single table and a comparison no longer feels like two different panels.
- **Relationships in the comparison inspector are now an N-column matrix**
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150)). Like the
  field matrix, relationship changes render as one row per related table (with the
  friendly legend label — Reference to / Referenced by / Child tables / M2M
  junction / Named relationship / DB view member / CI topology) and a present/absent
  cell per instance, coloured added / removed vs Base. The inspector is also
  **inheritance-complete for relationships**: relationships inherited from parent
  tables are included (tagged `inherited`), matching the single-instance view.
- **One "Differences" canvas toggle** — diff is diff, no structure/config split
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150)). The separate
  **Structure changes** and **Config drift** buttons on the Schema Map are
  replaced, while a comparison is active, by a single **Differences** toggle that
  paints the structural difference (added / removed / changed tables + edge pills)
  for the compared instances. **Config drift is no longer a canvas channel** —
  it's surfaced where it belongs: in the **inspector** (the Configuration section
  for the selected table) and in the sidebar report. The standalone config-drift
  overlay (used when no comparison is active) stands down during a comparison, so
  there's only ever one comparison control on the map.
- **One unified "Differences" report** in the diff sidebar
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150),
  [#149](https://github.com/revampd/sn-schema-explorer/issues/149)). The structural
  change report and the separate Configuration block are merged into a single
  report under **one change vocabulary**: a single Added / Removed / Changed
  summary row that counts **both** table changes and config-drift findings
  (drift / state → changed, an app gone in the compare → removed, a new app →
  added — it's one schema+config comparison, not two), and one list whose rows
  are **type-tagged** `table` or `app`. Config findings list first; clicking a
  summary tile filters the one list. Picking an app row still highlights its
  tables on the map. This removes both the two-stacked-reports and the
  two-tile-rows split.
- **Schema Diff is now a layer on the Schema Map, not a separate view**
  ([#141](https://github.com/revampd/sn-schema-explorer/issues/141); the
  [#130](https://github.com/revampd/sn-schema-explorer/issues/130) "integrated
  lenses" epic). Comparison is no longer a mode you switch into — you stay on the
  map and pick a **Compare** instance from the new header dropdown (beside the
  instance picker). The structural diff (added/removed/changed colouring, edge
  pills, the rich field/relationship inspector, and the change-report sidebar) and
  the config-drift layer then activate **on the map**, and a **Structure changes**
  toggle on the canvas mutes the structural colouring while keeping the
  comparison. Switching the loaded instance re-runs the comparison against the new
  base; clearing the Compare dropdown returns to the plain map. The separate
  "Diff" tab/view-mode is gone (the only views are now the map and Path Finder).
  Base, Compare, and a **swap (⇄)** control all live in the header; the old diff
  sidebar Base/Swap/Compare section is removed (the sidebar is now purely the
  change report). The header **Compare** picker is built to take more layers over
  time.

### Fixed

- **Starting a comparison no longer collapses the Schema Map.** A new comparison
  now shows the full graph with diff colouring by default (rather than narrowing
  to changed-only tables), so the map doesn't look emptied and Refresh visibly
  re-lays-out the whole graph. The **Changed only** toggle still narrows it on
  demand. (Pairs with the Differences overlay now auto-enabling on compare.)
- **Diff sidebar rows for compare-only tables are now clickable**
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150)). With several
  compares, the change report lists tables that exist only in a (non-primary)
  compare — those aren't grafted onto the Schema Map, so clicking them used to do
  nothing (the on-map focus silently no-opped). Selecting such a row now opens the
  comparison inspector for that table even though it isn't drawn on the map.
- **Comparison inspector now reads like the single-instance inspector**
  ([#150](https://github.com/revampd/sn-schema-explorer/issues/150)). Relationship
  changes are grouped by **Added / Removed** (what a change report is about), with
  the friendly relationship type from the edge-type legend shown inline on each
  row — **Reference to / Referenced by / Child tables / M2M junction / Named
  relationship / DB view member / CI topology** (plus reference direction, the
  related table's label, and the dot-walk field) — instead of raw
  `reference`/`rel`/`m2m` type strings. The inspector is now fully
  **inheritance-aware**, like the single-instance view: it shows a table's
  effective schema (own + inherited from parent tables, tagged `inherited`), and
  **flags a table whose only difference is inherited** — e.g. a parent field
  changed — even though `computeDiff` (own-fields-only) would call it identical.
  (The sidebar list and canvas stay own-change-based, attributing the change to
  the parent, so one parent edit doesn't flood the report with every descendant.)
  And a column that is **identical** to Base now reads **green** ("in sync"), not
  amber — the per-instance status strip and the field-matrix column headers are
  coloured by each instance's status.
- **The Compare control and swap (⇄) button now hide together** when a comparison
  isn't applicable — on the Home/landing page or when fewer than two schema
  instances are registered. The swap button previously stayed visible after the
  Compare control was hidden.
- **An instance can no longer compare against itself.** Switching the Base onto an
  instance already selected as a compare dropped a phantom "identical" self-column
  in the inspector and made the selection count disagree with the picker; that
  compare is now removed (clearing the comparison if it was the only one).
- **Schema Diff no longer leaks compare-only tables into the Schema Map.** Diff
  grafts the compare instance's added (`_diffOnly`) tables into the shared base
  graph so they render in the diff; switching back to the Schema Map didn't
  un-graft them, so a table that exists only in the _compare_ instance "merged"
  into the base and appeared in the map and its search. Leaving the Diff view now
  un-grafts those nodes/edges (and returning re-grafts them).

### Added

- **Configuration block in the Schema Diff sidebar** (`schema-diff/config-list.js`,
  [#139](https://github.com/revampd/sn-schema-explorer/issues/139); part of the
  [#130](https://github.com/revampd/sn-schema-explorer/issues/130) "integrated
  lenses" epic). Completes the config-drift layer's third pillar: a **Configuration**
  summary (In sync / Drift / Missing / State counts, clickable to filter) plus a
  navigable list of the **apps that changed** between base and compare, with each
  side's version. Picking an app brings the tables it owns into view and highlights
  them — so a table that drifted **only** in configuration (and so never appears in
  the structural diff list) is now reachable. Opt-in like the rest of the layer:
  the block is hidden unless both instances exported store/custom app metadata.

- **Config drift in the Schema Diff inspector** (`schema-diff/config-drift.js`,
  [#139](https://github.com/revampd/sn-schema-explorer/issues/139); part of the
  [#130](https://github.com/revampd/sn-schema-explorer/issues/130) "integrated
  lenses" epic). When comparing two instances, selecting a table now shows a
  **Configuration** section in the inspector — the owning application, its
  version/active on **each side** (base vs compare), and the drift status — beside
  the existing field- and relationship-level diff. A structurally-identical table
  whose app drifted is now also inspectable (a "Configuration drift" panel). A
  small corner **badge** marks drifted nodes on the canvas (a distinct channel
  from the diff stroke colours). Config is **opt-in**: it appears only when
  **both** instances exported store/custom app metadata — otherwise it's just a
  schema comparison, and an absent section is never mistaken for a missing app.
  Pairwise (base vs compare), reusing the Configuration Data classifier so the
  inspector, the map, and the table all agree. (N-way drift stays in the
  Configuration Data table.)

- **Unified comparison context** (`core/focus-state.js`,
  [#138](https://github.com/revampd/sn-schema-explorer/issues/138); part of the
  [#130](https://github.com/revampd/sn-schema-explorer/issues/130) "integrated
  lenses" epic). One shared "compare against" selection: a notifying
  `setCompareId` / `focusState.compareId` setter over the existing diff compare
  state, so Schema Diff and (next) the config-drift layer read and write the same
  value and `onFocusChange` fires when it changes. Foundation for surfacing config
  drift inside the Schema Diff view. No visible change — the Diff base/compare and
  swap behave as before, now routed through the single writer.

- **Config drift on the Schema Map** (`modules/config-overlay`,
  [#133](https://github.com/revampd/sn-schema-explorer/issues/133); part of the
  [#130](https://github.com/revampd/sn-schema-explorer/issues/130) "integrated
  lenses" epic). The first cross-lens overlay: a toggleable **layer** that tints
  schema-map tables by the **configuration drift** of the application that owns
  their scope, across your registered instances. A small canvas control turns it
  on (off by default) and shows a legend — in sync / drift / missing / state
  mismatch — using the **same** classification as the Configuration Data table,
  so the map and the table always agree. The scope→app join is the shared entity
  spine (#132); it covers store + custom apps, needs **≥2** app-capable instances
  (the control hides otherwise), and applies in the Schema Map (force) view. The
  scope colours, selection, and other overlays are untouched — drift is a layer
  on top, not a mode.

- **Shared entity spine** (`core/entity-spine.js`,
  [#132](https://github.com/revampd/sn-schema-explorer/issues/132); part of the
  [#130](https://github.com/revampd/sn-schema-explorer/issues/130) "integrated
  lenses" epic). A pure addressing layer that joins the Structure lens (schema
  nodes) to the Config lens (store / custom apps) by application **scope**, so a
  lens can resolve "what does Config know about this table?" as a lookup
  (`buildSpine(graph, instances).resolveTable(id)` → the owning app record per
  instance). Because today's exports spell scope two ways — nodes carry the
  scope's _display name_, apps carry the _technical_ scope plus the display name
  — the spine indexes each app under **both** and resolves a node by either, so
  it works with current exports and gets more robust if nodes later also carry
  the technical scope (an optional exporter hardening, tracked for later). The
  bridge covers store + custom apps only; plugins (name-keyed) and properties
  (global) don't link to a table. Substrate only — nothing consumes it yet; the
  config-drift overlay (#133) is the first consumer.

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
