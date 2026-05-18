# Overview

## What is Thunderbird Open Archiver?

A Thunderbird MailExtension that bridges Thunderbird users with their Open Archiver email archive. It enables searching, browsing, and deep-linking into archived emails without needing to switch to a web browser.

## Why not IMAP?

Open Archiver is not an IMAP store. It is a search-and-retention platform built on:

- **PostgreSQL** for structured metadata
- **Meilisearch** for full-text and attachment-content search
- **Object storage** for raw EML files and extracted attachments

Attempting to expose this as IMAP would lose Open Archiver's advanced search capabilities (OCR, attachment content, full-text across all fields). This extension preserves those capabilities by talking directly to the REST API.

## Supported Open Archiver Versions

**Currently supported:** v1.x (the version deployed at this project's Open Archiver instance).

The extension targets the `/v1/*` API namespace. Key endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/search` | GET | Full-text search with optional filters |
| `/v1/archived-emails/:id` | GET | Fetch single email details |
| `/v1/storage/download` | GET | Download raw EML file |

## Authentication

The extension supports two authentication methods:

1. **API Key** — header `X-API-Key: <key>`. Keys are generated in the Open Archiver UI (Settings → API Keys) with prefix `oa_live_`. Must have the `search:archive` permission.
2. **Bearer Token** — header `Authorization: Bearer <jwt>`. JWT tokens obtained via login.

See [Security](security.md) for best practices.
