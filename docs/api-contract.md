# API Contract

## Open Archiver Version

Target: **v1.x** — API namespace `/v1/*`. Backend runs on port `4000` by default. Web UI runs on port `3000` by default.

## Search API

### Request

```
GET /v1/search
```

#### Query Parameters

| Parameter | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `keywords` | conditional | string | — | Full-text search query. **Required** when no filters are provided. |
| `page` | no | integer | `1` | Page number (1-based) |
| `limit` | no | integer | `10` | Results per page |
| `matchingStrategy` | no | string | `last` | Meilisearch strategy: `last`, `all`, or `frequency` |
| `from` | no | string | — | Filter by sender email (exact match) |
| `to` | no | string | — | Filter by recipient email (exact match against any recipient in `to[]`) |
| `cc` | no | string | — | Filter by CC recipient email (exact match) |
| `bcc` | no | string | — | Filter by BCC recipient email (exact match) |
| `dateFrom` | no | string | — | Unix timestamp (seconds) or ISO 8601 date. Filters emails with `timestamp >= value`. |
| `dateTo` | no | string | — | Unix timestamp (seconds) or ISO 8601 date. Filters emails with `timestamp <= value`. |
| `ingestionSourceId` | no | string | — | Filter by ingestion source. Expands to the full merge group. |

#### Authentication Headers

Use one of:
- `X-API-Key: <api_key>` (preferred for add-on use)
- `Authorization: Bearer <jwt_token>`

#### Required Permission

`search:archive`

### Response

```json
{
  "hits": [
    {
      "id": "uuid",
      "userEmail": "string",
      "from": "string",
      "to": ["string"],
      "cc": ["string"],
      "bcc": ["string"],
      "subject": "string",
      "body": "string",
      "attachments": [{ "filename": "string", "content": "string" }],
      "timestamp": 1234567890,
      "ingestionSourceId": "uuid",
      "_formatted": { ... },
      "_matchesPosition": { ... }
    }
  ],
  "total": 123,
  "page": 1,
  "limit": 10,
  "totalPages": 13,
  "processingTimeMs": 42
}
```

#### Response Fields

| Field | Type | Always Present | Notes |
|-------|------|---------------|-------|
| `hits[].id` | string | yes | Same as `archived_emails.id` in PostgreSQL. Used for deep-linking. |
| `hits[].subject` | string | yes (may be empty) | Email subject line |
| `hits[].from` | string | yes | Sender email address |
| `hits[].to` | string[] | yes (may be empty) | Primary recipients |
| `hits[].cc` | string[] | yes (may be empty) | CC recipients |
| `hits[].bcc` | string[] | yes (may be empty) | BCC recipients |
| `hits[].body` | string | yes (may be empty) | Full body text (potentially large) |
| `hits[].timestamp` | number | yes | Unix timestamp (seconds) |
| `hits[].attachments` | array | yes | May be empty. Each has `filename` and extracted `content`. |
| `hits[]._formatted` | object | no | Meilisearch highlighted version of fields. Use `_formatted.body` for snippet. |
| `hits[]._matchesPosition` | object | no | Match positions for highlighting |
| `total` | number | yes | Total number of matching results |
| `page` | number | yes | Current page number |
| `totalPages` | number | yes | Total number of pages |
| `limit` | number | yes | Results per page |

### Derived Fields (Extension Normalization)

The extension's `normalize.js` derives these fields from the raw response:

| Derived Field | Source | Logic |
|---------------|--------|-------|
| `snippet` | `_formatted.body` or `body` | Use `_formatted.body` if available (contains `<em>` highlights), fall back to `body` truncated to ~200 chars |
| `hasAttachments` | `attachments` | `attachments.length > 0` |
| `deepLinkUrl` | `id` + frontend base URL | `{frontendBaseUrl}/dashboard/archived-emails/{id}` |

## Archived Email Detail API

### Request

```
GET /v1/archived-emails/:id
```

### Response (ArchivedEmail)

Returns full email details including thread information, tags, and attachment metadata.

## Error Responses

| Status | Meaning |
|--------|---------|
| 400 | `keywords` required (when no filters provided) or invalid parameter |
| 401 | Missing or invalid authentication |
| 403 | Valid auth but missing `search:archive` permission |
| 429 | Rate limited (default: 100 req/min/IP) |
| 500 | Server error |

## Stability Guarantees

- The `hits[].id` field is guaranteed to match `archived_emails.id` in PostgreSQL
- The `page`/`limit`/`totalPages` pagination model is stable
- The `_formatted` and `_matchesPosition` fields are Meilisearch-specific and may change format across Meilisearch version upgrades
- Filter parameters (`from`, `to`, `dateFrom`, etc.) are additions to the API — existing keyword-only search is unchanged
