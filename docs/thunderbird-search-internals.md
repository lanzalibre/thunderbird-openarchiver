# Thunderbird Search Internals — Research Notes

> **Phase 1 research for search provider API design.**
> Source: comm-central (master branch) at `https://github.com/mozilla/releases-comm-central`.
> Files verified by fetching from GitHub before citation.

---

## 1. Global Search Dispatch Flow

### 1.1 Search Bar UI

The global search bar is a XUL `textbox` element in the main window. There is **no standalone `SearchBar.sys.mjs` module** at `mail/modules/`. The search bar logic is a single 45-line file:

**`mail/base/content/searchBar.js`** (45 lines)
- Defines `GlodaSearchBoxTabMonitor` which monitors tab switches
- On tab open, saves/restores the search input value per-tab
- Only special handling for `"glodaFacet"` mode tabs (preserves `searchString`)
- Lines 37-43: Sets `searchInput.value` on the `.remote-gloda-search` element inside the facet tab

There is **no `mail/base/content/unifiedToolbar/` directory** on comm-central. Unified toolbar lives in mozilla-central platform code. The search bar on the unified toolbar dispatches to the same underlying machinery.

### 1.2 Search Dispatch Path

When a user types in the search bar and hits Enter:

1. The search input dispatches to `GlodaMsgSearcher` (see §2 below)
2. A `glodaFacet` tab is opened via `specialTabs.js` which calls `glodaFacetTabType.openTab()` with the searcher
3. The searcher executes the query asynchronously via Gloda's query pipeline
4. Results arrive in a `GlodaCollection` which drives the facet view

**There is NO extension point in this dispatch chain.** No observer notification, no event, no replaceable service. The search → Gloda path is hard-wired in the tab opening code.

---

## 2. Gloda Query Pipeline

### 2.1 Core Modules

| File | Lines | Purpose |
|------|-------|---------|
| `mailnews/db/gloda/modules/Gloda.sys.mjs` | 2257 | Main namespace. Defines nouns, attributes, attribute providers. Central dispatcher. |
| `mailnews/db/gloda/modules/GlodaPublic.sys.mjs` | 44 | Re-exports `Gloda` and triggers initialization of indexer and message indexer. What external code imports. |
| `mailnews/db/gloda/modules/GlodaConstants.sys.mjs` | 248 | Noun IDs (`NOUN_MESSAGE`, `NOUN_CONTACT`, etc.) and constraint type constants. |
| `mailnews/db/gloda/modules/GlodaQueryClassFactory.sys.mjs` | 637 | Generates per-noun query subclasses with constraint helpers. |
| `mailnews/db/gloda/modules/GlodaDatastore.sys.mjs` | 4393 | SQLite database layer. `queryFromQuery()` is the main query execution method. |
| `mailnews/db/gloda/modules/GlodaMsgSearcher.sys.mjs` | 357 | Fulltext searcher. The bridge between search UI and Gloda queries. |
| `mailnews/db/gloda/modules/GlodaMsgIndexer.sys.mjs` | 305 | AB indexer only; message indexing is in `IndexMsg.sys.mjs` |

### 2.2 Message Query Execution Path

#### Step 1: GlodaMsgSearcher builds a fulltext query

**`GlodaMsgSearcher.sys.mjs`** — key elements:

- **Constructor** (line 316-324): Takes `aListener`, `aSearchString`, `aAndTerms`. Parses terms, stores them.
- **`buildFulltextQuery()`** (line 347-375): Creates a Gloda query with `NOUN_MESSAGE`, injects raw SQL via `explicitSQL`. Uses the `NUEVO_FULLTEXT_SQL` constant (line 99-113).
- **`getCollection()`** (line 377-384): Calls `buildFulltextQuery()` then `query.getCollection(this, aData)` to execute.
- **`NUEVO_FULLTEXT_SQL`** (lines 99-113): A hand-crafted SQL query that:
  1. Uses FTS3 `MATCH` to find matching messages
  2. Orders by `DASCORE` (relevance ranking: `glodaRank(matchinfo(...)) + notability + date`)
  3. Applies LIMIT (default from `mailnews.database.global.search.msg.limit` pref)
  4. Joins `messagesText` (FTS table) with `messages` table
  5. Filters out deleted messages (`messages.deleted = 0`) and ghost messages (`folderID IS NOT NULL`)

#### Step 2: GlodaQueryClassFactory generates query classes

**`GlodaQueryClassFactory.sys.mjs`** — for each noun, creates four classes:

| Class | Purpose |
|-------|---------|
| `GlodaQueryClass` | Main query building. Constraint chaining, `or()`, `orderBy()`, `limit()`, `getCollection()`. |
| `GlodaNullQueryClass` | Never matches anything. Used for ghost/deleted items. |
| `GlodaExplicitQueryClass` | Matches only items already in a collection. For static snapshots. |
| `GlodaWildcardQueryClass` | Matches everything. Debug only. |

The `getCollection()` method (line 134-150) calls `this._nounDef.datastore.queryFromQuery(...)` which delegates to `GlodaDatastore.queryFromQuery()`.

#### Step 3: GlodaDatastore.queryFromQuery() executes SQL

**`GlodaDatastore.sys.mjs`** — query execution is complex:

- `queryFromQuery()` is the core query dispatcher. It:
  1. Converts constraint objects into SQL WHERE clauses
  2. Creates a `QueryFromQueryCallback` to handle async results
  3. Calls `statement.executeAsync()` with the callback
  4. Resolves cross-noun references (e.g., message → identity → contact) via `QueryFromQueryResolver`
  5. Creates or populates `GlodaCollection` objects

#### Step 4: GlodaMsgSearcher receives results

The `GlodaMsgSearcher` instance acts as both listener and collection owner:

- **`onItemsAdded()`** (line 390-400): Computes relevance scores via `Gloda.scoreNounItems()` using the `scoreOffsets` function, then forwards to the original listener.
- **`onQueryCompleted()`** (line 410-414): Sets `completed = true`, forwards to listener.

### 2.3 Noun System

Gloda defines a noun-based data model:

| Noun ID | Name | DB Table |
|---------|------|----------|
| 1 | `NOUN_BOOLEAN` | In-column |
| 2 | `NOUN_NUMBER` | In-column |
| 3 | `NOUN_STRING` | In-column |
| 10 | `NOUN_DATE` | In-column |
| 20 | `NOUN_FULLTEXT` | messagesText (FTS3) |
| 100 | `NOUN_FOLDER` | folderLocations |
| 101 | `NOUN_CONVERSATION` | conversations |
| 102 | `NOUN_MESSAGE` | messages |
| 103 | `NOUN_CONTACT` | contacts |
| 104 | `NOUN_IDENTITY` | identities |
| 105 | `NOUN_ATTACHMENT` | (via attributes) |
| 106 | `NOUN_ACCOUNT` | (via attributes) |

---

## 3. Search Results Rendering

### 3.1 Faceted Results

**`mail/base/content/glodaFacetTab.js`** (112 lines)
- Defines `glodaFacetTabType` — a tab mode named `"glodaFacet"`
- `openTab()` (line 16-60): Creates an iframe pointing to `glodaFacetViewWrapper.xhtml`, which loads `glodaFacetView.xhtml`
- Stores the `searcher`, `collection`, and `query` on the tab object
- Lines 24-37: If args include a `searcher`, creates both message and IM search collections

**`mail/base/content/glodaFacetView.js`** (1122 lines)
- The main facet view controller
- Uses `FacetDriver` from `resource:///modules/gloda/Facet.sys.mjs` for faceting logic
- `FacetContext` (line ~420): Central state object holding:
  - `facetDriver` — drives the faceting process
  - `_collection` — the Gloda collection with all results
  - `_activeSet` — the current working set after applying facet constraints
  - `_activeConstraints` — map of attribute name → constraint objects
  - `_sortBy` — sort by `"-dascore"` (relevance) or `"-date"`
- `initialBuild()` (line ~470): Called when results first arrive. Deduplicates by `headerMessageID`. Sets up facets.
- `build()` (line ~490): Kicks off a new faceting pass via `facetDriver.go()`.
- `facetingCompleted()` (line ~530): Renders facet widgets (`UIFacets.addFacet()`), then calls `_showResults()`.
- `_showResults()` (line ~600): Populates the `#results` element with `GlodaMessage` objects.
- `addFacetConstraint()` / `removeFacetConstraint()` (lines ~770-830): User interaction with facets re-filters the active set.

**`mail/base/content/glodaFacetView.xhtml`**
- XUL layout for the facet view page

**`mail/base/content/glodaFacetViewWrapper.xhtml`**
- Thin wrapper that loads the facet view in an iframe

**`/mailnews/db/gloda/modules/Facet.sys.mjs`** (not directly fetched)
- `FacetDriver` class that orchestrates the faceting process
- Called by `FacetContext.build()` — iterates over facets, counts groups, returns ordered groups

### 3.2 Quick Filter Bar (per-folder filtering)

**`mail/modules/QuickFilterManager.sys.mjs`** (1438 lines)
- Extensible filter system with `defineFilter()`, `killFilter()`, `createSearchTerms()`
- Each filter contributes `nsIMsgSearchTerm` objects to a search session
- Uses `QuickFilterSearchListener` wrapper to process results
- Built-in filters: sticky, unread, starred, addrBook, tags (with faceting!)
- **Already exposed via MailExtension** → `mailTabs.setQuickFilter()` with `QuickFilterTextDetail`

### 3.3 Search CSS

File not found at `mail/themes/shared/mail/search.css`. Search UI styles are likely in:
- `mail/themes/shared/mail/glodaFacetView.css` (if exists)
- Inline in the XUL/XHTML files

---

## 4. Existing Extension APIs Touching Search

### 4.1 `messages.query` (and related)

**`mail/components/extensions/schemas/messages.json`** — defines:
- `messages.query()` — search messages by folder, subject, author, recipients, etc. Uses `nsIMsgSearchSession` under the hood, NOT Gloda.
- `messages.get()` — get a single message by ID
- `messages.list()` — list messages in a folder
- `MessageList` type — paginated results with `id` pointer for next page

**`mail/components/extensions/ExtensionMessages.sys.mjs`** (3074 lines)
- Massive implementation file. Handles message conversion, MIME parsing, attachment extraction.
- Does NOT use Gloda for searching. Uses `nsIMsgSearchSession` + `nsIMsgSearchTerms`.

### 4.2 `mailTabs` API

**`mail/components/extensions/schemas/mailTabs.json`** (633 lines)
- `mailTabs.setQuickFilter()` — sets Quick Filter bar state (text filter, tags, unread, starred, attachment, etc.)
- `mailTabs.getListedMessages()` — gets messages currently displayed in the mail tab
- `mailTabs.getSelectedMessages()` / `setSelectedMessages()` — manipulate selection
- `mailTabs.onDisplayedFolderChanged` / `onSelectedMessagesChanged` — events

**`mail/components/extensions/ExtensionMailTabs.sys.mjs`** (84 lines)
- Thin file providing `getMsgHdrsForIndex()` and `getActualSelectedMessages()` helpers

### 4.3 Summary of What Extensions Can Already Do

| Capability | API | Search Backend |
|------------|-----|---------------|
| Search messages by field | `messages.query()` | `nsIMsgSearchSession` (not Gloda) |
| Filter displayed folder | `mailTabs.setQuickFilter()` | `nsIMsgSearchSession` |
| Get displayed messages | `mailTabs.getListedMessages()` | Current DB view |
| Get single message | `messages.get()` | Direct by ID |
| Full-text search | **NOT available** | — |
| Gloda-powered search | **NOT available** | — |
| Custom query pipeline | **NOT available** | — |

---

## 5. Experiment API Infrastructure

### 5.1 How Experiments Work

From the Thunderbird developer docs (https://developer.thunderbird.net/add-ons/mailextensions/experiments):

Experiments consist of three parts registered in `manifest.json`:

```json
"experiment_apis": {
  "MyAPI": {
    "schema": "api/MyAPI/schema.json",
    "parent": {
      "scopes": ["addon_parent"],
      "paths": [["MyAPI"]],
      "script": "api/MyAPI/implementation.js",
      "events": ["startup"]
    }
  }
}
```

- **Schema file** — JSON schema describing the API surface
- **Parent implementation** — runs in main process, full access to XPCOM and privileged JS
- **Child implementation** — (optional) runs in content process

### 5.2 Schema Locations on comm-central

- **Schemas**: `mail/components/extensions/schemas/`
  - `messages.json` — messages API
  - `mailTabs.json` — mail tabs API
  - `accounts.json`, `folders.json`, `compose.json`, etc.
- **Parent implementations**: `mail/components/extensions/parent/`
  - `ext-messages.js` — parent for messages API
  - `ext-mailTabs.js` — parent for mailTabs API
  - `ext-mail.js` — core mail extension support
- **Child implementations**: `mail/components/extensions/child/`
- **Shared utilities**: `mail/components/extensions/`
  - `ExtensionMessages.sys.mjs` — message conversion, MIME parsing
  - `ExtensionMailTabs.sys.mjs` — mail tab helpers
  - `ExtensionAccounts.sys.mjs` — account helpers
  - `ExtensionUtilities.sys.mjs` — general utilities

### 5.3 Experiment Capabilities

Experiments can:
- Import any `sys.mjs` module (including all Gloda internals)
- Access `Services.obs` for observer notifications
- Register XPCOM factories
- Access the full XPCOM API surface
- Directly manipulate XUL/DOM in the main process
- Cannot directly access WebExtension content scripts' scope (without `waiveXrays`)

---

## 6. Key Files & Hook Points

### 6.1 Hard-Wired Search Dispatch (NO Extension Point)

| File | Lines | Why It Matters |
|------|-------|---------------|
| `mail/base/content/searchBar.js` | 1-45 | Tab monitor for search input. Thin, no hooks. |
| `mail/base/content/specialTabs.js` | (openTab calls) | Creates glodaFacet tab when search is dispatched |
| `mail/base/content/glodaFacetTab.js` | 16-60 | Opens facet tab with GlodaMsgSearcher. Hard-wired. |

**Assessment**: The search bar → Gloda path has NO observer, event, or extension point. It calls `new GlodaMsgSearcher()` directly.

### 6.2 Gloda Hook Points

| File | Lines | Hook Potential |
|------|-------|---------------|
| `GlodaMsgSearcher.sys.mjs` | 316-324 | Constructor — can be monkeypatched via Experiment to intercept search strings |
| `GlodaMsgSearcher.sys.mjs` | 347-375 | `buildFulltextQuery()` — can be overridden to customize SQL |
| `GlodaMsgSearcher.sys.mjs` | 377-384 | `getCollection()` — can be wrapped to intercept results |
| `Gloda.sys.mjs` | `defineAttribute()` | Can register custom attribute providers (new indexable fields) |
| `GlodaDatastore.sys.mjs` | `queryFromQuery()` | Core query execution. Can be wrapped. |
| `GlodaPublic.sys.mjs` | 1-44 | Re-exports Gloda. The `Gloda.addIndexerListener()` is exposed here. |

### 6.3 Observer Notifications

From a search of observer topics in these files, no observer is fired during search dispatch. The indexer does fire notifications (`addrbook-contact-*`), but query dispatch does not.

### 6.4 QuickFilterManager Extension Point

| File | Lines | Hook Potential |
|------|-------|---------------|
| `QuickFilterManager.sys.mjs` | `defineFilter()` | Already extensible! Filters can add custom search terms. |
| `QuickFilterManager.sys.mjs` | `createSearchTerms()` | Called to build search terms for the current filter state. |
| `QuickFilterManager.sys.mjs` | `postFilterProcess()` | Optional per-filter hook after results are loaded. |

The `QuickFilterManager.defineFilter()` is already designed for extension — it accepts a `FilterDefinition` with lifecycle hooks. An Experiment could register a custom filter that intercepts the search session.

### 6.5 Gloda Collection System

| File | Lines | Hook Potential |
|------|-------|---------------|
| `Collection.sys.mjs` | (not fully fetched) | `GlodaCollectionManager` manages active collections. Can add listeners. |
| `Gloda.sys.mjs` | `getMessageCollectionForHeader()` | Returns a collection for a message header — useful for programmatic access |
| `Gloda.sys.mjs` | `getMessageCollectionForHeaders()` | Batch collection for many headers |

---

## 7. Assessment

### 7.1 What Requires a Pure MailExtension

| Feature | Feasible? | Why |
|---------|-----------|-----|
| `messages.query()` by field | ✅ Yes | Already implemented |
| `mailTabs.setQuickFilter()` | ✅ Yes | Already implemented |
| Get displayed messages | ✅ Yes | Already implemented |
| Full-text search via Gloda | ❌ No | No API exposes Gloda query results |
| Custom search results UI | ❌ No | Cannot create new tab types or hook into faceted view |

### 7.2 What Requires an Experiment

| Feature | Feasible? | Approach |
|---------|-----------|----------|
| Intercept search dispatch | ✅ Yes | Monkeypatch `GlodaMsgSearcher` or wrap `GlodaSearchBoxTabMonitor` |
| Custom search backend | ✅ Yes | Replace `GlodaMsgSearcher.prototype.getCollection()` + `buildFulltextQuery()` |
| Inject results into Gloda pipeline | ✅ Yes | Create synthetic `GlodaCollection` with custom results |
| Custom tab type for results | ✅ Yes | Register a new tab mode alongside `glodaFacet` |
| Register custom Gloda attributes | ✅ Yes | Call `Gloda.defineAttribute()` with a provider |
| Observe Gloda indexing | ✅ Yes | `Gloda.addIndexerListener()` (already exposed via `GlodaPublic.sys.mjs`) |
| QuickFilter custom filter | ✅ Yes | `QuickFilterManager.defineFilter()` from Experiment |
| Add new search filter types | ✅ Yes | Register with `QuickFilterManager.defineFilter()` |

### 7.3 What Requires a Core Patch

| Feature | Why Core Patch |
|---------|---------------|
| New search bar UI element | XUL/XHTML changes, mozilla-central unified toolbar |
| Observer notification on search dispatch | Need to add `Services.obs.notifyObservers()` in search dispatch path |
| Extension point in Gloda query pipeline | Need to add listener registration in `GlodaDatastore.queryFromQuery()` |
| New built-in `browser.messages` API method | Need schema + parent implementation in `mail/components/extensions/` |
| Modified facet view with custom panels | `glodaFacetView.xhtml` / `glodaFacetView.js` changes |
| New `about:` page for search | Need mozilla-central `about:` registration |

### 7.4 Recommended Architecture for a Custom Search Provider

A Thunderbird Experiment is the right mechanism. The approach:

1. **Intercept at `GlodaMsgSearcher`** — An Experiment can monkeypatch `GlodaMsgSearcher` to:
   - Intercept the search string before query building
   - Route to a custom search backend (local or remote API)
   - Return a synthetic `GlodaCollection` populated with results converted to `GlodaMessage` objects

2. **Tap into Gloda's existing noun system** — Convert custom results into `GlodaMessage` instances with populated attributes so existing faceting UI works.

3. **Register a custom tab** — Register a new `glodaFacet`-like tab type if custom results UI is needed, or use the existing facet tab by replacing the collection.

4. **No core patch required** for the interception layer, but a core patch would be needed to:
   - Add a formal observer notification for search dispatch
   - Register a new built-in WebExtension API (`browser.messages.search` with Gloda)
   - Add hooks to the unified toolbar search widget

### 7.5 Key Risks

1. **No observer pattern in dispatch** — Hard-wired `GlodaMsgSearcher` construction means monkeypatching is fragile across TB versions.
2. **Gloda SQL is version-specific** — The `NUEVO_FULLTEXT_SQL` hand-crafted SQL could change between versions.
3. **No Gloda search API for MailExtensions** — The existing `browser.messages.query` does NOT use Gloda; it uses `nsIMsgSearchSession`, which is a different indexing system. Gloda's fulltext search is entirely inaccessible to pure MailExtensions.
4. **Gloda data model is internal** — `GlodaMessage`, `GlodaCollection`, and related classes are not part of any public API. An Experiment can use them, but future refactoring may break custom code.
5. **Facet view is tightly coupled** — `glodaFacetView.js` makes many assumptions about the shape of items. Custom result items must satisfy those assumptions.
6. **No `unifiedToolbar` on comm-central** — The unified toolbar lives in mozilla-central. Any changes to the search bar widget itself require mozilla-central patches, which are more complex to land.
