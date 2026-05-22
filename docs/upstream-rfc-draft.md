# RFC: Search Provider API for Thunderbird MailExtensions

> **DRAFT** — Not yet filed. Prepared 2026-05-22.
> Intended audience: Thunderbird extensions API team.

---

## Problem Statement

Thunderbird's global search bar only searches the local message store (via Gloda). Users who maintain email archives in external systems (Open Archiver, Mailpile, Fastmail, custom SaaS) cannot search those archives from Thunderbird's unified search experience. They must switch to a separate web UI or use a sidebar extension.

There is currently no extension API that allows add-ons to register as search backends and surface results in Thunderbird's native search UX.

## Proposed Solution

Introduce a `searchProviders` MailExtension API that allows extensions to register custom search providers. The API would:

1. **Registration**: `browser.searchProviders.register(name, options)` — register a provider with label, icon, and timeout config
2. **Search dispatch**: `browser.searchProviders.onSearchRequest` event — fired when the user executes a search from the global search bar
3. **Result delivery**: `browser.searchProviders.sendResults(queryId, response)` — submit results back to Thunderbird for rendering in a dedicated provider section in the search results panel

### API Surface

See [docs/search-provider-api-spec.md](./search-provider-api-spec.md) for the full specification.

Key types:
- `SearchRequest`: queryId, searchString, filters (sender, recipient, dateFrom, dateTo), offset, limit, AbortSignal
- `SearchResult`: id, subject, sender, recipients, date, snippet, url (required) + cc, bcc, hasAttachments, tags (optional)
- `SearchResponse`: results[], totalCount, providerInfo (status: ok|error|unavailable|auth-error)

### UX Design

Each registered provider renders a collapsible section in the search results panel (glodaFacet view). Provider sections are ordered by registration time. Results are NOT blended across providers — each provider gets its own section with clear labeling.

## Prototype Status

A working Experiment prototype exists:

- **Repo**: [lanzalibre/thunderbird-openarchiver](https://github.com/lanzalibre/thunderbird-openarchiver)
- **Experiment API**: `addon/experiment_apis/searchProvider/` — schema + parent implementation
- **Provider**: `addon/src/background/search-provider.js` — Open Archiver integration
- **Test coverage**: 16 unit tests (provider response mapping, error handling, URL building)
- **Build**: `npm run build` → installable `.xpi`

### How the prototype works

1. The Experiment parent monkeypatches `GlodaMsgSearcher.prototype.getCollection` to intercept search dispatch
2. When the user presses Enter in the search bar, the monkeypatch fires an `onSearchRequest` event to the extension
3. The extension's OA provider calls the Open Archiver `/v1/search` API
4. Results are mapped to the `SearchResult` format and injected into the facet view's DOM as a custom section

### Prototype limitations

| Limitation | Impact |
|------------|--------|
| Monkeypatches internal module | Fragile across TB version updates |
| DOM injection for rendering | Tightly coupled to facet view implementation |
| No autocomplete dropdown integration | Results only appear on Enter, not during typing |
| MV2 only | MV3 Experiment surface not yet tested |

## Open Questions

1. **API home**: Should this be a new `searchProviders` namespace or a method on `browser.messages` (e.g., `browser.messages.onSearch`)?
   - Current proposal: `searchProviders` namespace for clarity and extensibility

2. **Rendering**: Should the API provider results natively (new XUL/HTML component in comm-central) or should providers provide their own results UI via WebExtensions?
   - Current proposal: Native rendering with a defined SearchResult schema. Providers return data, Thunderbird renders it.

3. **Scope**: Should this API be limited to the global search bar, or should it also support per-folder Quick Filter bar searches?
   - Current proposal: Global search bar only in v1. Quick Filter integration deferred.

4. **Security**: How do we prevent malicious extensions from intercepting and exfiltrating search queries?
   - Current thinking: Provider registration requires a user-visible permission prompt. Display a "Search via [Provider]" indicator in the search UX.

5. **Streaming**: Should the API support streaming results (provider sends results incrementally)?
   - Current proposal: No — simple request-response in v1. Streaming via `sendResults()` can be added later.

6. **Result limits**: Should there be a system-wide cap on total provider results per search?
   - Current proposal: Per-provider limit of 50 results, configurable at registration time.

## Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| Experiment only (no core changes) | Ships today, no upstream review needed | Fragile, limited capabilities, ATN review hurdle |
| Built-in API (core patch) | Stable, documented, all extensions can use | Requires upstream comm-central patch, longer timeline |
| Hybrid: Experiment → built-in API | Proof of concept first, upstream later | Two implementations, migration cost |

**Recommendation**: Start with the Experiment API as a proving ground. After gathering feedback from the add-on community, migrate to a built-in API in comm-central.

## References

- Spec: [docs/search-provider-api-spec.md](./search-provider-api-spec.md)
- Research: [docs/thunderbird-search-internals.md](./thunderbird-search-internals.md)
- Requirements: [docs/requirements-search-provider.md](./requirements-search-provider.md)
- Prototype notes: [docs/prototype-notes.md](./prototype-notes.md)
- Implementation: `addon/experiment_apis/searchProvider/`
