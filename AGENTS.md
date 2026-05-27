# AGENTS.md — Open Archive TB Extension

## Project Goal
Display archived emails (downloaded as decrypted .eml via OA API) inside Thunderbird when user clicks a search result.

## Constraint
Files are AES-256-CBC encrypted on NAS (`oa_enc_idf_v1::` prefix). Must download decrypted bytes via `GET /v1/storage/download?path=...` — cannot read encrypted files directly.

## Architecture
- MV2 Thunderbird extension
- Experiment API (`searchProvider`) handles download + display
- Background script (`search-provider.js`) fetches `storagePath` per result from `GET /v1/archived-emails/{id}`
- Click handler in `api.js` downloads via `NetUtil.asyncFetch` (only viable HTTP API in experiment sandbox)

## Current Approach
- Download .eml bytes via OA API
- Convert to string, extract headers via `MimeParser.extractHeaders()` (works)
- Extract body via manual MIME parser: finds last `Content-Type` in outer headers (before first `\n\n--`), parses multipart boundaries, decodes QP/base64 per part, decodes bytes as UTF-8 via manual `utf8Decode()`, prefers HTML over plain text
- Build custom HTML viewer with header bar + body; display via `data:text/html` in `contentTab` with subject as tab title
- Save .eml to OS temp dir (`TmpD`) — auto-cleaned by OS
- No `browser_action` toolbar button — access config via `about:addons`

## Approach History
All approaches tested (native tab types, MimeParser, manual parsers) and key technical findings documented in [docs/approaches.md](docs/approaches.md).

## Relevant Files
- `addon/experiment_apis/searchProvider/api.js` — parent experiment — download + display logic
- `addon/src/background/search-provider.js` — `storagePath` fetch per result
- `addon/experiment_apis/searchProvider/schema.json` — extended schema

## Build
```bash
npm run build  # produces dist/thunderbird-openarchiver.xpi
```
