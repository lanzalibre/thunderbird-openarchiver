# Architecture

## Components

```
┌─────────────────────────────────────────────────┐
│                  Thunderbird                     │
│  ┌───────────────────────────────────────────┐  │
│  │        Search Panel (sidebar/tab)          │  │
│  │  ┌─────────────┐  ┌────────────────────┐  │  │
│  │  │  Query Form  │  │   Results List     │  │  │
│  │  │  + Filters   │  │  (scrollable)      │  │  │
│  │  └──────┬──────┘  └────────┬───────────┘  │  │
│  │         │                  │               │  │
│  │         └──────┬───────────┘               │  │
│  │                │                            │  │
│  │         ┌──────┴───────┐                   │  │
│  │         │ Background   │                   │  │
│  │         │ Script (api) │                   │  │
│  │         └──────┬───────┘                   │  │
│  └────────────────┼──────────────────────────┘  │
└───────────────────┼────────────────────────────┘
                    │ HTTPS
                    ▼
┌─────────────────────────────────────────────────┐
│              Open Archiver Backend               │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐ │
│  │ Express  │  │Meilisearch│  │  PostgreSQL   │ │
│  │ API      │  │  Index    │  │  (metadata)   │ │
│  └──────────┘  └───────────┘  └──────────────┘ │
└─────────────────────────────────────────────────┘
```

## Data Flow

1. User enters query + optional filters in the Search Panel
2. Panel sends message to Background Script via `browser.runtime.sendMessage()`
3. Background Script builds URL, adds auth headers, calls `GET /v1/search?keywords=...&from=...`
4. Open Archiver queries Meilisearch, returns JSON results
5. Background Script normalizes the response (maps fields, derives snippet/hasAttachments)
6. Panel renders the results list
7. User clicks a result → Background Script opens `{frontendBaseUrl}/dashboard/archived-emails/{id}` in system browser

## State Management

- **Settings** are persisted in `browser.storage.local` (API URL, frontend URL, API key, preferences)
- **Search state** is held in panel memory (current query, page, results)
- **Auth state** is stateless (each request carries the API key or token from storage)
