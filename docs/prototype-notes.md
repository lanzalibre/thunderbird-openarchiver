# Prototype Notes — Phase 3

> **Date**: 2026-05-22
> **Status**: Experiment API defined, Open Archiver provider written, tests passing (16/16). Build and smoke test results below.

---

## Experiment API Structure

| File | Purpose |
|------|---------|
| `addon/experiment_apis/searchProvider/schema.json` | API schema with `register`, `unregister`, `sendResults`, `sendError` functions and `onSearchRequest` event |
| `addon/experiment_apis/searchProvider/api.js` | Parent implementation: monkeypatches `GlodaMsgSearcher.prototype.getCollection`, injects results into facet view DOM |
| `addon/src/background/search-provider.js` | OA provider: handles `onSearchRequest`, calls OA `/v1/search`, maps response to provider format |
| `addon/test/unit/api.test.js` | Tests extended with 10 new test cases for provider response mapping |

## How It Works

1. **Registration**: `search-provider.js` calls `browser.searchProviders.register("openarchiver", ...)` on startup
2. **Hook**: The Experiment parent (`api.js`) monkeypatches `GlodaMsgSearcher.prototype.getCollection` on first registration
3. **Interception**: When the user types a query in the global search bar and presses Enter:
   - GlodaMsgSearcher.getCollection is called
   - The wrapper fires `onSearchRequest` event to the extension (fire-and-forget, non-blocking)
   - Gloda's original search still runs in parallel
4. **Provider**: The extension receives `onSearchRequest`, calls OA `/v1/search` with the query, maps the response
5. **Injection**: `sendResults()` is called, the parent injects a custom section into the glodaFacet view's DOM showing OA results

## DOM Injection Approach

Results are injected into the facet view's content document via:
- Finding the active `glodaFacet` tab's browser element
- Accessing its `contentDocument`
- Creating a `<div id="oa-search-results">` with OA results styled to match Thunderbird's UI
- Inserting it before the `#results` container

## Gaps Surfaced

| Gap | Impact | Mitigation |
|-----|--------|------------|
| No observer/event in search dispatch | Must monkeypatch, fragile across versions | Documented in upstream RFC as need for formal API |
| Gloda data model is internal | Cannot easily create synthetic GlodaMessage objects | DOM injection approach avoids this |
| Facet view is an iframe | Timing issues injecting results | Section only appears after facet view loads |
| No `unifiedToolbar` on comm-central | Search bar widget changes require mozilla-central patches | Out of scope for prototype |
| `GlodaMsgSearcher` import path may vary | `resource:///modules/gloda/GlodaMsgSearcher.sys.mjs` may not be correct for all TB versions | Verify against TB 128 ESR |

## Performance Findings

- Monkeypatch overhead: negligible (vanilla JS wrapper)
- DOM injection: O(n) where n = number of results
- OA API latency: depends on network; timeout set to 5s
- No blocking: OA search runs async, Gloda results appear immediately, OA section appears when ready

## UX Issues

- OA section appears below Gloda's facet widgets, above the results list
- Section header shows provider name and result count
- Each result shows subject, sender, date, and snippet
- Click opens deep link in browser tab
- Error states: "authentication failed" / "service unavailable" / generic error
- **No integration with the autocomplete dropdown** (deferred — results panel only)

## Build Result

```
npm run build
  → scripts/package-addon.sh generates .xpi at dist/thunderbird-openarchiver.xpi
```

Build succeeded. XPI includes all experiment_apis files, manifest, background scripts, and provider.

## Smoke Test

**Automatic smoke test not possible from CLI (requires Thunderbird GUI).** Operator should:

1. `npm run build` (already done)
2. Open Thunderbird → Add-ons → Settings (gear) → Debug Add-ons
3. Click "Load Temporary Add-on"
4. Select `dist/thunderbird-openarchiver.xpi`
5. Type a query in the global search bar
6. Press Enter → glodaFacet view opens with search results
7. Verify "Open Archiver Archive" section appears with results
8. Capture screenshot into `docs/screenshots/`

**Expected**: When the facet view loads, the `GlodaMsgSearcher` monkeypatch fires `onSearchRequest`. The OA provider fetches from `/v1/search`. Results are injected as a `<div id="oa-search-results">` before the `#results` container. Section shows subject, sender, date, and snippet for each result.

## Screenshots

Pending manual smoke test.
