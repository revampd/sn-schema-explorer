# SN Schema Explorer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Visualise your ServiceNow table schema — inheritance chains, reference fields,
M2M relationships, CMDB CI topology — in a single self-contained HTML file.
No installation, no server, no external dependencies.

> **Community tool** — not developed, endorsed, or affiliated with ServiceNow, Inc.

## Features

- Force-directed Schema Map with adjustable hop depth, max nodes, and edge-type filters
- Inspect any table's fields, types, inheritance chain, references, M2M links, and CMDB CI topology
- Search by table name **or** field name across the full dataset
- Path Finder — shortest dot-walk path between any two tables or to a specific field *(full build)*
- Schema Diff — compare two exports to see added, removed, and changed tables/fields *(full build)*
- Saved Views — snapshot and restore named view configurations
- Export graph as PNG or SVG; export schema or neighbourhood as JSON
- Custom colour-coded export background with opacity control

## Getting the tool

Three pre-built flavours are available. Download from [Releases](../../releases).

| File | Contents | Use when |
|---|---|---|
| `sn_schema_explorer_lite.html` | Schema Map · Inspector · Export · Settings · Guide | Sharing with clients or lightweight use |
| `sn_schema_explorer.html` | Everything in Lite + Path Finder + Schema Diff | Full feature set for internal use |
| `sn_schema_explorer_setup.html` | Everything in Full + embedded exporter scripts | Self-service onboarding — colleagues can copy the exporters directly from the tool |

## Exporting your schema from ServiceNow

### Option A — Background Script (recommended)

Requires the `admin` role. No instance-side configuration needed.

1. Navigate to **System Definition → Scripts - Background**
2. Switch the application scope picker to **Global**
3. Paste the Background Script (copy from the **Setup Instructions** tab in `sn_schema_explorer_setup.html`)
4. Click **Run script** — takes 45–90 s on a typical instance
5. The output is saved as a JSON attachment on your user record; download it from **Self-Service → My Profile → Attachments**

### Option B — Node.js extractor

Requires Node.js 18+ and network access to your instance.

```bash
# Basic Auth
node sn-schema-export.js \
  --instance=https://your-instance.service-now.com \
  --user=admin --password=*** \
  --output=schema.json

# API key auth (alternative to user/password)
node sn-schema-export.js \
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

Copy the extractor script from the **Setup Instructions** tab in `sn_schema_explorer_setup.html`, or find it in `dist/exporter/` after a build.

## Loading and exploring

1. Open the HTML file in any modern browser
2. Drag and drop your `schema.json` onto the drop zone (or click to browse)
3. The Schema Map renders immediately — click any table to inspect it
4. Use the **Max Nodes** and **Hop Depth** sliders to control graph density
5. Enable **Path Finder** or **Schema Diff** via **Settings → Features**

Large schemas are split into a manifest + `.part*.json` files — drop all files at once and the loader reassembles them automatically.

## Build from source

Prerequisites: Node.js 18+, npm

```bash
git clone https://github.com/<owner>/sn-schema-explorer.git
cd sn-schema-explorer
npm install
npm run build        # builds all targets
```

Output lands in `dist/`. Individual targets:

```bash
npm run build:lite     # lite only
npm run build:full     # full only
npm run build:setup    # full + setup instructions
npm run build:export   # exporter scripts only
```

## Disclaimer

This project is an independent, community-built tool and is NOT developed, endorsed,
supported, or affiliated with ServiceNow, Inc. in any way. "ServiceNow" is a registered
trademark of ServiceNow, Inc. Use at your own risk.
