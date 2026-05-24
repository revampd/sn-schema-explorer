# Schema Explorer for ServiceNow

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Visualise your ServiceNow table schema — inheritance chains, reference fields,
M2M relationships, CMDB CI topology — in a single self-contained HTML file.
No installation, no server, no external dependencies.

> **Community tool** — not developed, endorsed, or affiliated with ServiceNow, Inc.

## Features

- Force-directed Schema Map with adjustable hop depth, max nodes, and edge-type filters
- Advanced filter builder — narrow the canvas by scope, table type, name, field, edge type, field count, or custom prefix
- Inspect any table's fields, types, inheritance chain, references, M2M links, and CMDB CI topology
- Search by table name **or** field name across the full dataset
- Path Finder — shortest dot-walk path between any two tables or to a specific field; hop exclusions to suppress hub tables
- Schema Diff — compare two exports to see added, removed, and changed tables/fields
- Saved Views — snapshot and restore named view configurations
- Export as PNG, SVG, JSON, Markdown, JSON-LD, OWL/Turtle, or OpenAPI YAML
- Custom colour-coded export background with opacity control
- CMDB CI topology edges and ServiceNow Data Model Reference (CSDM 5)

![Schema Map](screenshots/screenshot-feature-schema_map.jpg)
![Diff](screenshots/screenshot-feature-diff.jpg)
![Pathfinder](screenshots/screenshot-feature-pathfinder.jpg)

## Getting the tool

One file does everything. Download `sn_schema_explorer.html` from [Releases](../../releases).

It includes the Schema Map, Inspector, Path Finder, Schema Diff, Export, Settings, Guide,
and Setup Instructions (with the exporter scripts embedded for easy copy-paste).

## Exporting your schema from ServiceNow

### Option A — Background Script (recommended)

Requires the `admin` role. No instance-side configuration needed.

1. Navigate to **System Definition → Scripts - Background**
2. Switch the application scope picker to **Global**
3. Paste the Background Script (copy from the **Setup Instructions** tab inside `sn_schema_explorer.html`)
4. Make sure **Execute in sandbox?** is unchecked — sandbox mode blocks the attachment write
5. Click **Run script** — takes 45–90 s on a typical instance
6. The output is saved as a JSON attachment on your user record; download it from **Self-Service → My Profile → Attachments**

### Option B — Node.js extractor

Requires Node.js 18+ and network access to your instance.

```bash
# Basic Auth
node sn-schema-export.node.standalone.js \
  --instance=https://your-instance.service-now.com \
  --user=admin --password=*** \
  --output=schema.json

# API key auth (alternative to user/password)
node sn-schema-export.node.standalone.js \
  --instance=https://your-instance.service-now.com \
  --apikey=<sn_api_key> \
  --output=schema.json
```

Key flags:

| Flag | Default | Description |
|---|---|---|
| `--instance` | — | Instance URL (required) |
| `--user` / `--password` | — | Basic Auth credentials |
| `--apikey` | — | API key auth (alternative to user+password) |
| `--output` | `schema.json` | Output file path |
| `--include-record-counts` | off | Add per-table record counts (adds 5–15 min) |
| `--page-size` | `1000` | Rows per API request |

Environment variable equivalents: `SN_INSTANCE`, `SN_USER`, `SN_PASSWORD`, `SN_APIKEY`, `SN_OUTPUT`, `SN_PAGE_SIZE`.

Copy the extractor script from the **Setup Instructions** tab inside `sn_schema_explorer.html`, or find it in `dist/exporter/` after a build.

## Loading and exploring

1. Open `sn_schema_explorer.html` in any modern browser
2. Drag and drop your `schema.json` onto the drop zone (or click to browse)
3. The Schema Map renders immediately — click any table to inspect it
4. Use the **Max Nodes** and **Hop Depth** sliders to control graph density
5. Use **Filter** in the header to narrow the canvas by scope, type, field, or edge
6. Enable **Path Finder** or **Schema Diff** via **Settings → Features**

Large schemas are split into a manifest + `.part*.json` files — drop all files at once and the loader reassembles them automatically.

## Build from source

Prerequisites: Node.js 18+, npm

```bash
git clone https://github.com/revampd/sn-schema-explorer.git
cd sn-schema-explorer
npm install
npm run build        # builds all targets
```

Output lands in `dist/`. Individual targets:

```bash
npm run build:app      # dist/sn_schema_explorer.html
npm run build:export   # dist/exporter/* (bg script + node extractor)
```

## Disclaimer

This project is an independent, community-built tool and is NOT developed, endorsed,
supported, or affiliated with ServiceNow, Inc. in any way. "ServiceNow" is a registered
trademark of ServiceNow, Inc. Use at your own risk.
