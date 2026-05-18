# Security

## API Key Management

- API keys (prefix `oa_live_...`) grant access to your Open Archiver archive
- Store API keys only in Thunderbird's `browser.storage.local` — never in code or files
- Use **least-privilege** API keys. At minimum the key needs the `search:archive` permission.
- If a key is compromised, revoke it immediately in Open Archiver Settings → API Keys

## Credential Storage

The extension uses `browser.storage.local` which is encrypted at rest on most platforms. However:
- Any Thunderbird extension with the `storage` permission can read this data
- Any process with access to the Thunderbird profile directory can read it
- Consider this a convenience storage, not a hardened vault

## "Remove All Saved Credentials"

The options page includes a button to clear all stored credentials. Use this before screenshots, demos, or when handing off your machine.

## Logging

The extension never logs:
- Full API keys or tokens
- Full URLs containing auth tokens
- Complete response bodies

Debug logs use redaction: `[REDACTED]` replaces credential values.

## Network

- The extension communicates exclusively over HTTPS (except for local development on `localhost`)
- All API requests include authentication headers
- Rate limiting (100 req/min/IP) prevents abuse

## Thunderbird Permissions

The extension requests these permissions:

| Permission | Reason |
|------------|--------|
| `storage` | Save API base URL, frontend URL, and API key |
| `tabs` | Open deep links in system browser (fallback) |
| `notifications` | Show error notifications if needed |
