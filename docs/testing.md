# Testing

## Test Strategy

### Unit Tests (Jest)

Run with: `npm test`

Test files in `addon/test/unit/` cover:

- **URL normalization** — trailing slashes, protocol, path handling
- **Auth header construction** — API key vs Bearer token
- **Search parameter serialization** — mapping UI fields to query params
- **Response normalization** — mapping API response to internal format, handling missing fields

### Fixture-Based Tests

Tests use `examples/sample-search-response.json` as input for normalization tests. This ensures rendering logic works against realistic data shapes.

### Negative Path Tests

- Invalid base URL
- Invalid or missing API key  
- Network timeout
- API schema changes (unexpected fields, missing optional fields)

## Manual Testing Matrix

| Thunderbird Version | macOS | Open Archiver Version | Notes |
|---------------------|-------|----------------------|-------|
| 115 (Supernova) | yes | v1.x | Primary target |
| 128 ESR | yes | v1.x | LTS target |
| 136+ (newer) | yes | v1.x | Should work, not actively validated |

## CI

GitHub Actions runs lint + test on every push and pull request (see `.github/workflows/ci.yml`).
