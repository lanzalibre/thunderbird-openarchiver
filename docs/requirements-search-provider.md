# Search Provider API — Requirements

## User Stories

- **As a user**, I can search my Open Archiver email archive from Thunderbird's global search bar without switching to the sidebar or popup.
- **As a user**, I see Open Archiver results in a clearly labeled "Open Archiver" section alongside local email results in the search results panel.
- **As a user**, clicking an Open Archiver result opens the full archived email in the Open Archiver web UI (`{frontendBaseUrl}/dashboard/archived-emails/{id}`).
- **As a user**, I can apply filters (sender, recipient, date range) to narrow Open Archiver results from within Thunderbird's search interface.
- **As a user**, I receive clear, actionable feedback when Open Archiver is unreachable, authentication fails, or no results are found.
- **As a developer**, I can register a custom search provider via a documented Experiment API surface without modifying Thunderbird core.

## Non-Goals

| Non-Goal | Rationale |
|----------|-----------|
| Local mirroring of the email archive | Out of scope — the provider queries the remote API on every search |
| Custom Thunderbird fork | The API must work within the existing add-on/Experiment framework |
| Re-ranking results across providers | Each provider's results appear in its own section; no cross-provider relevance blending |
| Write operations through search results | No reply, archive, delete, or move actions on provider results — only deep-link open |
| Attachment preview within Thunderbird | Attachments remain in the Open Archiver web UI |
| Offline search | The provider requires network access to the OA backend |
| MV3 support in Phase 3 prototype | MV2 is the stable target; MV3 migration planned for Phase 6 |

## Version Support Matrix

| Thunderbird | Manifest | Experiment APIs | Phase 3 Target | Phase 6 Target | Notes |
|-------------|----------|-----------------|----------------|----------------|-------|
| 128 ESR | MV2 | Full support | **Primary** | — | Longest-supported stable channel; add-on ecosystem standard |
| 133+ (Release, 137+) | MV3 | Evolving | — | **Target** | MV3 migration in progress; re-test Experiment surface |

## Explicit Decisions

### (a) Where results appear in Thunderbird's UI

**Decision: Dedicated section in the search results panel, with secondary integration into the global search dropdown.**

- **Primary surface**: When the user presses Enter in the global search bar, Thunderbird opens a search results panel (glodaFacetView or the mail tab's search mode). Each registered provider renders a collapsible section showing its results (subject, sender, date, snippet).
- **Secondary surface**: The autocomplete dropdown can show quick results from providers alongside local contacts/messages.
- **Rationale**: The search results panel offers enough space for rich results, per-provider grouping, and error states. The autocomplete dropdown is bandwidth-constrained and competes with Thunderbird's own quick results. Phase 3 will implement the results-panel section; dropdown integration is deferred.

### (b) `strict_min_version` target

**Decision: `128.0` for Phase 3 prototype; `137.0` for Phase 6 production target.**

- Thunderbird 128 ESR is the current Extended Support Release as of 2026-05-22. It fully supports MV2 manifest and `experiment_apis` — the only viable path for the Phase 3 prototype.
- `strict_min_version: "128.0"` ensures compatibility with the broadest stable user base.
- Phase 6 targets `137.0+` (MV3) once the Experiment surface stabilises and Mozilla's MV3 migration is well-documented. The operator should monitor https://bugzilla.mozilla.org/ for MV3 Experiment compatibility.

### (c) MV2 vs MV3 for the prototype

**Decision: MV2 for Phase 3 prototype.**

- The existing extension (`addon/manifest.json`) already uses `manifest_version: 2` and `applications.gecko.strict_min_version: "115.0"`.
- MV2 offers full, well-documented `experiment_apis` support. MV3's Experiment surface is still evolving and would introduce additional risk during prototyping.
- The prototype should focus on proving the search-provider concept; MV3 migration is a packaging/validation concern for Phase 6.
- The manifest entry for the Experiment prototype will add `"experiment_apis"` alongside the existing MV2 structure. No changes to the `manifest_version` key.

## Open Archiver Search API Reference

The Open Archiver Search API (`GET /v1/search`) returns paginated results with hits containing `id`, `subject`, `from`, `to[]`, `body`, `timestamp`, and `attachments`. See `docs/api-contract.md` for full schema. The provider in Phases 3 and 6 maps these fields into the search provider result format.

## Dependencies

- `docs/api-contract.md` — Open Archiver Search API specification
- `docs/thunderbird-search-internals.md` — Phase 1 deliverable identifying hook points
- `docs/search-provider-api-spec.md` — Phase 2 deliverable defining the provider contract
