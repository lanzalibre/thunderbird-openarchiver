/**
 * API wrapper for Open Archiver backend.
 * Centralizes HTTP calls so UI code stays decoupled from fetch/network details.
 */

async function searchArchive({
  apiBaseUrl,
  apiKey,
  authToken,
  keywords,
  from,
  to,
  cc,
  bcc,
  dateFrom,
  dateTo,
  ingestionSourceId,
  page = 1,
  limit = 10,
}) {
  const url = new URL(`${apiBaseUrl.replace(/\/+$/, '')}/v1/search`);
  const params = new URLSearchParams();

  if (keywords) params.set('keywords', keywords);
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (cc) params.set('cc', cc);
  if (bcc) params.set('bcc', bcc);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (ingestionSourceId) params.set('ingestionSourceId', ingestionSourceId);

  url.search = params.toString();

  const headers = buildAuthHeaders(apiKey, authToken);
  headers['Accept'] = 'application/json';

  const response = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(15000) });

  if (response.status === 401) {
    throw new ApiError('Unauthorized: Check your API key or token', 'AUTH_ERROR', 401);
  }
  if (response.status === 403) {
    throw new ApiError('Forbidden: API key lacks search:archive permission', 'PERMISSION_ERROR', 403);
  }
  if (response.status === 429) {
    throw new ApiError('Rate limited: Too many requests', 'RATE_LIMIT', 429);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      body.message || `HTTP ${response.status}`,
      'API_ERROR',
      response.status
    );
  }

  const data = await response.json();
  return normalizeSearchResults(data);
}

async function testConnection({ apiBaseUrl, apiKey, authToken }) {
  const url = `${apiBaseUrl.replace(/\/+$/, '')}/v1/search?keywords=test&limit=1`;
  const headers = buildAuthHeaders(apiKey, authToken);
  headers['Accept'] = 'application/json';

  const response = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(10000) });

  if (response.ok) return { ok: true, message: 'Connection successful' };

  if (response.status === 401) {
    return { ok: false, message: 'Invalid API key or token' };
  }
  if (response.status === 403) {
    return { ok: false, message: 'API key missing search:archive permission' };
  }
  return { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
}

function buildAuthHeaders(apiKey, authToken) {
  if (apiKey) return { 'X-API-Key': apiKey };
  if (authToken) return { 'Authorization': `Bearer ${authToken}` };
  return {};
}
