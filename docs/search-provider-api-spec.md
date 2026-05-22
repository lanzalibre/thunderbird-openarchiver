# Search Provider API Specification v0

> Phase 2 design for a Thunderbird search provider MailExtension/Experiment API.
> Prototype target: MV2 Experiment (Phase 3). Upstream target: MV3 built-in API.
> Cross-referenced against `docs/api-contract.md` (Open Archiver Search API).

---

## 1. Registration Contract

### 1.1 Registration

Extensions register as search providers at runtime:

```
browser.searchProviders.register(name, options)
```

**Parameters**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Unique provider identifier (e.g., `"openarchiver"`). Must match `^[a-z][a-z0-9_-]{2,31}$`. |
| `options.label` | `string` | yes | Human-readable label (e.g., `"Open Archiver Archive"`). Displayed as section header in results. |
| `options.icon` | `string` | no | Icon URL (data URI or extension-relative path). 16x16 or 32x32. |
| `options.defaultQueryLimit` | `integer` | no | Max results per query (default 10, max 50). |
| `options.timeoutMs` | `integer` | no | Per-query timeout in ms (default 5000, max 15000). |
| `options.searchHandler` | `function` | yes | Async function called with `SearchRequest` → returns `SearchResponse`. |

### 1.2 Unregistration

```
browser.searchProviders.unregister(name)
```

Removes a previously registered provider. Ongoing queries for that provider are cancelled.

### 1.3 Manifest Entry (Optional)

For providers that do not need runtime registration, a manifest-level declaration is supported:

```json
{
  "search_providers": [
    {
      "name": "openarchiver",
      "label": "Open Archiver Archive",
      "icon": "assets/oa-icon.svg",
      "default_query_limit": 10,
      "timeout_ms": 5000
    }
  ]
}
```

Manifest-declared providers are auto-registered on startup and auto-unregistered on shutdown. Runtime `register()` is preferred for dynamic scenarios.

### 1.4 Scope

Providers receive search requests from:
- **Global search bar** (Enter → results panel) — primary scope
- Future: per-folder Quick Filter bar

Results are rendered in the search results panel as a dedicated collapsible section per provider.

---

## 2. Search Request Shape

### 2.1 `SearchRequest`

```
browser.searchProviders.onSearchRequest.addListener((request) => { ... })
```

Or passed to the `searchHandler` function at registration time.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `queryId` | `string` | yes | Unique per-query ID. Used for cancellation and response correlation. |
| `searchString` | `string` | yes | The user's raw search query. May be empty (initial load). |
| `filters` | `object` | no | Optional contextual filters (see below). |
| `offset` | `integer` | no | Pagination offset (0-based). Default 0. |
| `limit` | `integer` | no | Max results to return. Default = provider's `defaultQueryLimit`. |
| `signal` | `AbortSignal` | yes | AbortSignal to cancel the query. Fires when user changes query or provider is unregistered mid-query. |

### 2.2 Filters Object

| Field | Type | Description |
|-------|------|-------------|
| `sender` | `string` | Filter by sender email (exact match) |
| `recipient` | `string` | Filter by recipient email (exact match against any recipient) |
| `dateFrom` | `integer` | Unix timestamp (seconds). Include messages on or after this date. |
| `dateTo` | `integer` | Unix timestamp (seconds). Include messages on or before this date. |
| `folder` | `string` | Folder URI. Not applicable for external providers — ignored if unsupported. |
| `hasAttachments` | `boolean` | Whether messages must have attachments |
| `tags` | `string[]` | Tags/categories to filter by. Not all providers support this. |

### 2.3 Cancellation Signal

The `request.signal` is an `AbortSignal` that fires when:
- The user types a new query (previous query is cancelled)
- The provider is unregistered
- The query times out (provider timeout)

Providers should `request.signal.throwIfAborted()` or listen to `request.signal.onabort` to abort in-flight network requests.

---

## 3. Search Response Shape

### 3.1 `SearchResponse`

Returned by `searchHandler` or via `browser.searchProviders.sendResults(queryId, results)`.

```typescript
interface SearchResponse {
  results: SearchResult[];
  totalCount: number;      // Total matching results (for pagination)
  pagination?: {
    offset: number;        // Same as request.offset
    limit: number;         // Same as request.limit
    total: number;         // Same as totalCount
  };
  providerInfo: {
    name: string;          // Unique provider name
    label: string;         // Display label for the section
    status: "ok" | "error" | "unavailable" | "auth-error";
    message?: string;      // Human-readable status message (e.g., "Service unreachable")
  };
}
```

### 3.2 `SearchResult`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | Unique result ID (usually the email UUID). Used for deep-linking and dedup. |
| `subject` | `string` | yes | Email subject line (may be empty). |
| `sender` | `string` | yes | Sender email address or name `<email>`. |
| `senderName` | `string` | no | Sender display name (if separate from email). |
| `recipients` | `string[]` | yes | Primary recipient email addresses. |
| `date` | `integer` | yes | Unix timestamp (seconds). |
| `snippet` | `string` | yes | Excerpt of email body with search term highlighting (≤300 chars). |
| `url` | `string` | yes | Deep-link URL opened on click. |
| `cc` | `string[]` | no | CC recipients. |
| `bcc` | `string[]` | no | BCC recipients. |
| `tags` | `string[]` | no | Tags/categories. |
| `hasAttachments` | `boolean` | no | Whether the message has attachments. |
| `relevanceScore` | `number` | no | 0.0-1.0 relevance score for potential future cross-provider ranking. |
| `avatarUrl` | `string` | no | Sender avatar URL. |
| `folderPath` | `string` | no | Folder path (for provider-synced folders). |

### 3.3 Required vs Optional Fields

**Must provide**: `id`, `subject`, `sender`, `recipients`, `date`, `snippet`, `url`.

**Should provide**: `hasAttachments`, `cc`, `relevanceScore` (if available from backend).

**May omit**: `bcc`, `tags`, `avatarUrl`, `folderPath`, `senderName` (pass empty/null).

---

## 4. Lifecycle

### 4.1 Query Flow

```
User types query in global search bar
  → Thunderbird dispatches to GlodaMsgSearcher (local)
  → Experiment intercepts, also dispatches to registered providers
  → For each provider:
       → Fire onSearchRequest with search string + filters + AbortSignal
       → Provider calls backend API (e.g., OA /v1/search)
       → Provider returns SearchResponse or throws
       → If timeout (default 5s): provider section shows "Timed out"
       → If error: provider section shows error message
       → If success: render results in provider's section
  → Results from all providers render in parallel, each in own section
  → User clicks result → opens url in browser tab
```

### 4.2 Timeouts

- Default per-provider timeout: 5000ms
- Configurable at registration time via `timeoutMs` option (max 15000ms)
- On timeout: the `AbortSignal` fires, provider section shows "Timed out — service did not respond in time"
- Other providers' results still display

### 4.3 Cancellation

- User modifies query → previous query's `AbortSignal` fires
- Provider unregistered → all in-flight queries cancelled
- Providers must check `request.signal.aborted` or catch `request.signal.throwIfAborted()`

### 4.4 Error Reporting

Each provider returns a `providerInfo.status`:

| Status | When | UI Treatment |
|--------|------|-------------|
| `ok` | Success | Results displayed normally |
| `error` | General failure | Provider section shows error message with retry prompt |
| `unavailable` | Backend unreachable | Provider section shows "Service unavailable — check network connection" |
| `auth-error` | Authentication failed | Provider section shows "Authentication failed — check your API key in settings" |

One provider failing never blocks other providers.

### 4.5 Result Limits

- Default: 10 results per provider per query
- Provider can cap via `defaultQueryLimit`
- Pagination: `offset`/`limit` in request → provider returns paginated results
- Future: lazy-load more results on scroll ("Show more" button in section)

---

## 5. Actions on Results

### 5.1 Default Action

Clicking a search result calls `browser.tabs.create({ url: result.url })` (or equivalent).

The URL is the provider's deep-link URL. For Open Archiver:
```
{frontendBaseUrl}/dashboard/archived-emails/{result.id}
```

### 5.2 Future Optional Actions

| Action | Trigger | Requires |
|--------|---------|----------|
| Copy to clipboard | Right-click → "Copy link" | Standard context menu API |
| Download attachment | Right-click → "Download attachment" | Provider returns attachment URLs |
| Open in Thunderbird tab | Right-click → "Open in tab" | Tab type registration |

These are deferred beyond Phase 3.

---

## 6. Multi-Provider Coexistence

### 6.1 Section Rendering

Each provider gets a collapsible section in the search results panel:
- Section header: provider icon + label + result count
- Header supports collapse/expand
- Sections ordered by registration time (first registered = topmost)
- Empty sections are hidden (no results + no error)

### 6.2 No Cross-Provider Ranking

Results are NOT blended across providers in Phase 3. Each provider's results stay in their own section. Cross-provider relevance normalization is a future concern.

### 6.3 Provider Isolation

- One slow/failing provider does not impact others
- Each provider has its own timeout and cancellation signal
- Provider unregistration cleans up all its UI sections and cancels in-flight queries

---

## 7. Example: Open Archiver Provider (Pseudo-Code)

```javascript
// Registered by the Open Archiver extension at startup

browser.searchProviders.register("openarchiver", {
  label: "Open Archiver Archive",
  icon: "assets/oa-icon.svg",
  defaultQueryLimit: 10,
  timeoutMs: 5000,

  async searchHandler(request) {
    // Read auth config from extension storage
    const { apiBaseUrl, apiKey } = await browser.storage.local.get([
      "apiBaseUrl", "apiKey"
    ]);

    // Build query parameters
    const params = new URLSearchParams();
    if (request.searchString) params.set("keywords", request.searchString);
    params.set("page", String(Math.floor(request.offset / request.limit) + 1));
    params.set("limit", String(request.limit));

    if (request.filters?.sender) params.set("from", request.filters.sender);
    if (request.filters?.recipient) params.set("to", request.filters.recipient);
    if (request.filters?.dateFrom) params.set("dateFrom", String(request.filters.dateFrom));
    if (request.filters?.dateTo) params.set("dateTo", String(request.filters.dateTo));

    // Fetch with timeout + cancellation
    const response = await fetch(
      `${apiBaseUrl}/v1/search?${params}`,
      {
        headers: { "X-API-Key": apiKey },
        signal: request.signal,
      }
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return {
          results: [],
          totalCount: 0,
          providerInfo: {
            name: "openarchiver",
            label: "Open Archiver Archive",
            status: "auth-error",
            message: "Authentication failed — check your API key in extension settings.",
          },
        };
      }
      if (response.status === 429) {
        throw new Error("Rate limited by Open Archiver");
      }
      throw new Error(`Open Archiver returned ${response.status}`);
    }

    const data = await response.json();

    // Map OA response to SearchResult format
    const results = data.hits.map((hit) => ({
      id: hit.id,
      subject: hit.subject || "(no subject)",
      sender: hit.from,
      recipients: hit.to,
      date: hit.timestamp,
      snippet: hit._formatted?.body
        ? hit._formatted.body.slice(0, 300)
        : hit.body.slice(0, 300),
      url: `${frontendBaseUrl}/dashboard/archived-emails/${hit.id}`,
      cc: hit.cc || [],
      bcc: hit.bcc || [],
      hasAttachments: (hit.attachments?.length || 0) > 0,
    }));

    return {
      results,
      totalCount: data.total,
      pagination: {
        offset: request.offset,
        limit: request.limit,
        total: data.total,
      },
      providerInfo: {
        name: "openarchiver",
        label: "Open Archiver Archive",
        status: "ok",
      },
    };
  },
});
```

---

## 8. Example Manifest Entry

```json
{
  "manifest_version": 2,
  "name": "Open Archiver Search",
  "version": "0.1.0",
  "applications": {
    "gecko": {
      "id": "openarchiver-search@lanzalibre.github.io",
      "strict_min_version": "128.0"
    }
  },
  "experiment_apis": {
    "searchProvider": {
      "schema": "experiment_apis/searchProvider/schema.json",
      "parent": {
        "scopes": ["addon_parent"],
        "paths": [["searchProviders"]],
        "script": "experiment_apis/searchProvider/api.js",
        "events": ["startup"]
      }
    }
  },
  "permissions": [
    "storage",
    "tabs",
    "notifications",
    "http://localhost/*",
    "https://localhost/*"
  ],
  "background": {
    "scripts": [
      "src/lib/errors.js",
      "src/lib/normalize.js",
      "src/lib/validate.js",
      "src/background/api.js",
      "src/background/auth.js",
      "src/background/state.js",
      "src/background/search-provider.js"
    ]
  }
}
```

---

## 9. Cross-Reference: Open Archiver Search API vs Provider Response

| OA Field (per `docs/api-contract.md`) | Provider Result Field | Gap? |
|----------------------------------------|----------------------|------|
| `hits[].id` | `id` | ✅ Direct match |
| `hits[].subject` | `subject` | ✅ Direct match |
| `hits[].from` | `sender` | ✅ Direct match |
| `hits[].to[]` | `recipients` | ✅ Direct match |
| `hits[].timestamp` | `date` | ✅ Direct match |
| `hits[]._formatted.body` or `hits[].body` | `snippet` | ✅ Use `_formatted.body` (truncated 300 chars), fallback to `body` |
| `hits[].id` + `frontendBaseUrl` | `url` | ✅ Derived: `{frontendBaseUrl}/dashboard/archived-emails/{id}` |
| `hits[].cc[]` | `cc` | ✅ Direct match (optional) |
| `hits[].bcc[]` | `bcc` | ✅ Direct match (optional) |
| `hits[].attachments` | `hasAttachments` | ✅ Derived: `attachments.length > 0` |
| — | `senderName` | ⚠️ OA returns only `from` (email). Could parse name from `From: "Name" <email>` format. |
| — | `relevanceScore` | ⚠️ Not provided by OA. Could derive from `_matchesPosition` count. |
| — | `tags` | ⚠️ Not provided by OA currently. Future: `hits[].tags` might be added. |
| — | `avatarUrl` | ⚠️ Not provided by OA. Gravatar could be derived from sender email. |
| — | `folderPath` | ⚠️ Not applicable — OA is an external archive, not folder-based. |

**Summary**: No blocking gaps. All required provider fields (`id`, `subject`, `sender`, `recipients`, `date`, `snippet`, `url`) can be populated from OA's response. The optional fields `senderName`, `relevanceScore`, `tags`, `avatarUrl`, and `folderPath` are nice-to-haves and either have fallback strategies or are explicitly not applicable.

---

## 10. Experiment vs Built-in API

| Aspect | Experiment (Phase 3) | Built-in API (Upstream Target) |
|--------|---------------------|-------------------------------|
| Location | `experiment_apis/` in add-on | `mail/components/extensions/schemas/` in comm-central |
| Dispatch hook | Monkeypatch `GlodaMsgSearcher` | Formal observer/event notification |
| Rendering | Inject into facet view | Custom results panel component |
| Schema | Local `schema.json` | `mail/components/extensions/schemas/searchProviders.json` |
| Review | ATN Experiment review | Mozilla API review |
| Stability | May break across TB versions | Stable, documented, tested |

---

## 11. Open Questions

1. Should providers support "push" results (e.g., new results arrive after initial response, like streaming)?
   - Phase 3: No. Simple request-response.
   - Future: Optional `SearchResponse` streaming via `sendResults()`.

2. Should the search results panel support inline preview (e.g., show email body in a preview pane)?
   - Phase 3: No. Only deep-link to web UI.
   - Future: If Thunderbird adds an iframe preview, providers could render inline.

3. Should there be a system-wide provider enable/disable toggle (like search engines in Firefox)?
   - Not in Phase 3. User manages by installing/uninstalling extensions.
   - Future: `about:addons` → extension preferences → per-provider toggle.

4. Should providers be able to replace the default Gloda search entirely?
   - Phase 3: No. Provider results are additional, not replacement.
   - Future: Configurable default provider per account/folder.

---

## 12. Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-05-22 | v0 | Initial specification. Based on Phase 1 research findings. |
