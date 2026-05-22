# Open Archiver Search Provider

> Production-grade search provider implementation for Open Archiver integration.
> Uses the Thunderbird search provider Experiment API.

---

## Setup

### Prerequisites

- Thunderbird 128 ESR or later
- Open Archiver backend running (default: `http://localhost:4000`)
- Open Archiver Web UI (default: `http://localhost:3000`)
- API key with `search:archive` permission

### Configuration

1. Install the add-on (`dist/thunderbird-openarchiver.xpi`)
2. Open add-on preferences (Tools → Add-ons → Open Archiver Search → Preferences)
3. Configure:
   - **API Base URL**: Your Open Archiver backend URL (e.g., `http://localhost:4000`)
   - **Web UI Base URL**: Your Open Archiver frontend URL (e.g., `http://localhost:3000`) — used for deep links
   - **API Key** or **Auth Token**: Authentication credentials
4. Click "Test Connection" to verify

### Verification

1. After saving settings, type a query in Thunderbird's global search bar
2. Press Enter — the search results panel opens
3. Look for the "Open Archiver Archive" section alongside local results
4. Click a result to open the full email in the Open Archiver web UI

---

## Architecture

```
User types query → TB global search bar → Enter
  → GlodaMsgSearcher.getCollection (monkeypatched)
    → fires onSearchRequest event to extension
      → debounce (300ms)
      → read settings from storage
      → fetch OA /v1/search with filters
      → on success: sendResults()
      → on failure: classifyError → sendError()
    → Experiment parent injects section into facet view
```

## Features

| Feature | Implementation |
|---------|---------------|
| Debounced search | 300ms debounce — avoids API calls on fast typing |
| Timeout | 5s hard timeout via `AbortSignal.timeout()` |
| Retry | 1 retry on network failure (transient errors only) |
| Rate limit awareness | Detects HTTP 429, parses `Retry-After` header, backs off (max 10s) |
| Filter support | sender, recipient, dateFrom, dateTo, cc, bcc |
| Error classification | auth-error / unavailable / error with actionable messages |
| Graceful degradation | Shows "Service unavailable" section, does not crash provider pipeline |
| Deep links | Opens `{frontendBaseUrl}/dashboard/archived-emails/{id}` |

## Filter Mapping

| Provider Filter | OA API Parameter | Notes |
|-----------------|-----------------|-------|
| `sender` | `from` | Exact match |
| `recipient` | `to` | Exact match against `to[]` |
| `recipientCc` | `cc` | Exact match against `cc[]` |
| `recipientBcc` | `bcc` | Exact match against `bcc[]` |
| `dateFrom` | `dateFrom` | Unix timestamp (seconds) |
| `dateTo` | `dateTo` | Unix timestamp (seconds) |
| `searchString` | `keywords` | Full-text search query |

## Error Handling

| Scenario | User Sees | Status |
|----------|-----------|--------|
| API key missing | "Authentication not configured — set in preferences" | `auth-error` |
| 401 Unauthorized | "Authentication failed — check your API key" | `auth-error` |
| 403 Forbidden | "Access denied — missing search:archive permission" | `auth-error` |
| 429 Rate limited | "Rate limited — please wait" | `error` |
| Network error | "Could not reach Open Archiver — check URL and network" | `unavailable` |
| Timeout | "Did not respond in time (5s timeout)" | `unavailable` |
| Generic error | Error message from server | `error` |
| Empty results | "No results" (empty section, no error) | `ok` |

## Security Model

- **API keys** are stored in `browser.storage.local` (Thunderbird's built-in encrypted storage)
- **No secrets in git**: `.env` files and any committed keys stay out of version control
- **HTTPS enforced**: Non-localhost URLs require HTTPS (validated by extension)
- **Permissions requested**: `storage` (settings), `tabs` (open deep links), `notifications` (error alerts)
- **Data sent**: Search queries, filter parameters, and auth headers are sent to the configured OA backend
- **Data NOT sent**: No telemetry, no analytics, no user tracking

## Limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| MV2 only | Not compatible with Thunderbird MV3 builds | Phase 6 MV3 migration planned |
| No autocomplete dropdown | Results only appear on Enter, not during typing | Core patch needed for dropdown integration |
| Single provider per add-on | Only one OA backend per extension instance | Run multiple instances for multiple backends |
| No attachment preview | Attachments open in OA web UI | Future: download via attachment URL |
| No write operations | Cannot reply/archive/delete from search results | Out of scope — OA web UI handles actions |
| Pagination: only first page | Shows max 10 results initially | Future: "Show more" button in section |

## Required OA API Version

Target: **Open Archiver v1.x** — API namespace `/v1/*`.

The provider uses these OA endpoints:
- `GET /v1/search` — Search archive with keywords and filters

The provider assumes:
- Response includes `hits[]`, `total`, `page`, `limit`, `totalPages`
- Each hit has `id`, `subject`, `from`, `to[]`, `timestamp`, `body`
- Optional: `_formatted.body` for highlighted snippets
- Optional: `cc[]`, `bcc[]`, `attachments[]`
- Rate limiting via HTTP 429 with `Retry-After` header
- Authentication via `X-API-Key` or `Authorization: Bearer`
