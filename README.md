# Thunderbird Open Archiver

A Thunderbird MailExtension that integrates with [Open Archiver](https://github.com/open-archiver)'s REST API to search, browse, and open archived emails directly from Thunderbird.

## Features

- **Full-text search** across your Open Archiver archive using Meilisearch-powered search
- **Filtered search** by sender, recipient, date range, and mailbox
- **Deep linking** to Open Archiver's web UI for full message inspection
- **Secure** API key or JWT authentication with local credential storage

## Requirements

- Thunderbird 115+ (Supernova) or 128+ ESR
- Open Archiver instance with API access (see [Supported Versions](docs/overview.md#supported-versions))
- An API key with `search:archive` permission

## Installation

### Development (temporary add-on)

1. Clone this repo
2. Open Thunderbird → ☰ → Add-ons & Themes → Tools → Debug Add-ons
3. Click "Load Temporary Add-on" and select `addon/manifest.json`

### Packaged (.xpi)

1. Download the latest `.xpi` from [Releases](https://github.com/lanzalibre/thunderbird-openarchiver/releases)
2. Open Thunderbird → ☰ → Add-ons & Themes → Tools → Install Add-on From File
3. Select the downloaded `.xpi`

## Configuration

1. After installation, open the add-on's preferences (☰ → Add-ons & Themes → Open Archiver → Preferences)
2. Enter your Open Archiver **API base URL** (e.g., `http://localhost:4000`)
3. Enter your Open Archiver **Web UI base URL** (e.g., `http://localhost:3000`)
4. Enter your **API key** or JWT token
5. Click **Test Connection** to verify

## Development

See [Development Guide](docs/development.md).

## License

MIT
