# Thunderbird Open Archiver

Search your [Open Archiver](https://github.com/LogicLabs-OU/OpenArchiver) email archive and view archived emails directly inside Thunderbird via a custom email viewer.

## How It Works

- Registers as a Thunderbird search provider via the **Experiment API** (`searchProvider`)
- Hooks **Enter** keypress in Thunderbird's search bar to dispatch queries to the OA API
- Fetches `storagePath` per result from `GET /v1/archived-emails/{id}`
- Downloads decrypted `.eml` bytes via `GET /v1/storage/download?path=...` using `NetUtil.asyncFetch`
- Renders the email in a `contentTab` as a `data:text/html` data URI with:
  - Header bar (subject, from, to, date)
  - Decoded HTML or plain-text body
  - Multipart MIME parsing with QP/base64 + UTF-8 decoding

## Requirements

- Thunderbird 151+ (MV2 experiment API)
- Open Archiver instance with API access
- API key with `search:archive` permission

## Build

```bash
npm run build   # produces dist/thunderbird-openarchiver.xpi
```

## Installation

### Development (temporary)

1. Open Thunderbird → ☰ → Add-ons & Themes → Tools → Debug Add-ons
2. Click "Load Temporary Add-on" and select `addon/manifest.json`

### Packaged (.xpi)

1. Open Thunderbird → ☰ → Add-ons & Themes → Tools → Install Add-on From File
2. Select the `.xpi`

## Configuration

Configure via `about:addons` → Open Archiver → Preferences:
- **API base URL** (e.g., `http://localhost:4000`)
- **API key** or JWT token

## Technical Notes

- **Experiment API sandbox** lacks `fetch`, `XMLHttpRequest`, `btoa`, `TextDecoder` — HTTP via `NetUtil.asyncFetch`, UTF-8 via manual decoder
- **`MailServices.messageServiceFromURI`** maps `file://` → `mailbox://`, breaking native `mailMessageTab` display for downloaded `.eml` files
- **Gmail export format** duplicates headers (OA metadata + full RFC822) — body parser finds the last `Content-Type` in outer headers only
- Downloaded `.eml` files are written to the OS temp dir (`TmpD`), auto-cleaned by the system

## License

GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE).
