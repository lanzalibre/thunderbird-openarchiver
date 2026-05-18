# Development Guide

## Prerequisites

- Thunderbird 115+ or 128+ ESR
- Node.js 18+
- npm or yarn

## Setup

```bash
git clone https://github.com/lanzalibre/thunderbird-openarchiver.git
cd thunderbird-openarchiver
npm install
```

## Loading in Thunderbird (Temporary)

1. Open Thunderbird
2. Go to ☰ → Add-ons & Themes → gear icon → Debug Add-ons
3. Click "Load Temporary Add-on"
4. Select `addon/manifest.json`

## Development Workflow

1. Make changes to files in `addon/`
2. Reload the extension in Thunderbird's Debug Add-ons panel
3. Check the Browser Console (Ctrl+Shift+J / Cmd+Shift+J) for errors

## Lint

```bash
npm run lint
```

## Test

```bash
npm test
```

The test runner is Jest. Unit tests live in `addon/test/unit/`. Fixture data lives in `addon/test/fixtures/`.

## Package

```bash
bash scripts/package-addon.sh
```

Produces a `.xpi` file in the `dist/` directory.

## Project Structure

```
thunderbird-openarchiver/
├── addon/
│   ├── manifest.json          # Extension manifest
│   ├── src/
│   │   ├── background/        # Background scripts (API, auth, state)
│   │   ├── ui/                # UI pages (popup, options, search panel)
│   │   ├── lib/               # Shared libraries (validate, normalize, errors)
│   │   └── assets/            # Icons, images
│   └── test/                  # Tests
├── docs/                      # Documentation
├── scripts/                   # Build & tooling scripts
├── examples/                  # Example configs and fixtures
└── .github/workflows/         # CI/CD
```
