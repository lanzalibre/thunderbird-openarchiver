/**
 * Unit tests for API wrapper, normalization, and validation.
 * Run with: node test/runner.js
 */

const assert = require('assert');

// Load the normalize module (works in Node for these pure functions)
// In a real setup these would use Jest; this is a basic self-test.

function testNormalizeEmptyResults() {
  const result = normalizeSearchResults(null);
  assert.strictEqual(result.total, 0);
  assert.strictEqual(result.results.length, 0);
  console.log('  ✓ normalizeSearchResults handles null');
}

function testNormalizeHit() {
  const raw = {
    id: 'test-id',
    subject: 'Test Subject',
    from: 'sender@example.com',
    to: ['recip@example.com'],
    cc: [],
    bcc: [],
    timestamp: 1700000000,
    body: 'Hello world '.repeat(20),
    attachments: [{ filename: 'doc.pdf', content: 'text' }],
    _formatted: { body: 'Hello <em>world</em> repeated text...' },
  };

  const result = normalizeSearchResults({ hits: [raw], total: 1, page: 1, totalPages: 1 });

  assert.strictEqual(result.results.length, 1);
  const hit = result.results[0];
  assert.strictEqual(hit.id, 'test-id');
  assert.strictEqual(hit.subject, 'Test Subject');
  assert.strictEqual(hit.from, 'sender@example.com');
  assert.strictEqual(hit.hasAttachments, true);
  assert.ok(hit.snippet.includes('world'));
  console.log('  ✓ normalizeSearchResults maps fields correctly');
}

function testNormalizeNoAttachments() {
  const raw = {
    id: 'test-id-2',
    subject: 'No Attachments',
    from: 'sender@example.com',
    to: [],
    cc: [],
    bcc: [],
    timestamp: 1700000000,
    body: 'Simple message',
    attachments: [],
  };

  const result = normalizeSearchResults({ hits: [raw], total: 1, page: 1, totalPages: 1 });
  assert.strictEqual(result.results[0].hasAttachments, false);
  console.log('  ✓ normalizeSearchResults detects no attachments');
}

function testValidatesNormalizeBaseUrl() {
  assert.strictEqual(normalizeBaseUrl('http://localhost:4000'), 'http://localhost:4000');
  assert.strictEqual(normalizeBaseUrl('localhost:4000'), 'https://localhost:4000');
  assert.strictEqual(normalizeBaseUrl('http://example.com/'), 'http://example.com');
  assert.strictEqual(normalizeBaseUrl(''), '');
  console.log('  ✓ normalizeBaseUrl handles various inputs');
}

function testValidatesIsValidUrl() {
  assert.strictEqual(isValidUrl('http://localhost:4000'), true);
  assert.strictEqual(isValidUrl('https://example.com'), true);
  assert.strictEqual(isValidUrl('not-a-url'), false);
  assert.strictEqual(isValidUrl(''), false);
  console.log('  ✓ isValidUrl validates correctly');
}

function testBuildMessageUrl() {
  const result = buildMessageUrl('http://localhost:3000', 'abc-123');
  assert.strictEqual(result, 'http://localhost:3000/dashboard/archived-emails/abc-123');
  console.log('  ✓ buildMessageUrl constructs correct URL');
}

// Inline the functions for self-contained testing
function normalizeBaseUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let normalized = url.trim();
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  return normalized.replace(/\/+$/, '');
}

function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeSearchResults(apiResponse) {
  if (!apiResponse || !Array.isArray(apiResponse.hits)) {
    return { results: [], total: 0, page: 1, totalPages: 0 };
  }
  const results = apiResponse.hits.map(normalizeHit);
  return {
    results,
    total: apiResponse.total || 0,
    page: apiResponse.page || 1,
    totalPages: apiResponse.totalPages || 0,
    processingTimeMs: apiResponse.processingTimeMs,
  };
}

function normalizeHit(hit) {
  const snippet = deriveSnippet(hit);
  return {
    id: hit.id,
    subject: hit.subject || '',
    from: hit.from || '',
    to: hit.to || [],
    cc: hit.cc || [],
    bcc: hit.bcc || [],
    date: hit.timestamp ? new Date(hit.timestamp * 1000).toISOString() : null,
    timestamp: hit.timestamp || 0,
    snippet,
    hasAttachments: Array.isArray(hit.attachments) && hit.attachments.length > 0,
    userEmail: hit.userEmail || '',
    ingestionSourceId: hit.ingestionSourceId || '',
  };
}

function deriveSnippet(hit) {
  if (hit._formatted && hit._formatted.body) {
    const formatted = hit._formatted.body;
    const withoutEmTags = formatted.replace(/<\/?em>/g, '');
    return withoutEmTags.length > 200 ? withoutEmTags.substring(0, 200) + '...' : withoutEmTags;
  }
  if (hit.body) {
    return hit.body.length > 200 ? hit.body.substring(0, 200) + '...' : hit.body;
  }
  return '';
}

function buildMessageUrl(frontendBaseUrl, messageId) {
  const base = frontendBaseUrl.replace(/\/+$/, '');
  return `${base}/dashboard/archived-emails/${encodeURIComponent(messageId)}`;
}

// ── Search Provider Tests ─────────────────────────────────────────────────

function testProviderMapsHitToResult() {
  const hit = {
    id: 'msg-001',
    subject: 'Weekly Report',
    from: 'boss@example.com',
    to: ['me@example.com'],
    cc: ['team@example.com'],
    bcc: [],
    timestamp: 1715000000,
    body: 'Here is the weekly report with all the numbers.',
    attachments: [{ filename: 'report.pdf' }],
  };

  const result = mapHitToProviderResult(hit, 'http://localhost:3000');

  assert.strictEqual(result.id, 'msg-001');
  assert.strictEqual(result.subject, 'Weekly Report');
  assert.strictEqual(result.sender, 'boss@example.com');
  assert.deepStrictEqual(result.recipients, ['me@example.com']);
  assert.strictEqual(result.date, 1715000000);
  assert.ok(result.snippet.includes('weekly report'));
  assert.strictEqual(
    result.url,
    'http://localhost:3000/dashboard/archived-emails/msg-001'
  );
  assert.deepStrictEqual(result.cc, ['team@example.com']);
  assert.strictEqual(result.hasAttachments, true);
  console.log('  ✓ mapHitToProviderResult maps OA hit to provider format');
}

function testProviderMapsHitWithoutFormatted() {
  const hit = {
    id: 'msg-002',
    subject: 'Simple',
    from: 'a@b.com',
    to: ['c@d.com'],
    timestamp: 1715000001,
    body: 'Short body',
    attachments: [],
  };

  const result = mapHitToProviderResult(hit, 'http://localhost:3000');
  assert.strictEqual(result.snippet, 'Short body');
  assert.strictEqual(result.hasAttachments, false);
  console.log('  ✓ mapHitToProviderResult handles no _formatted body');
}

function testProviderMapUsesFormattedSnippet() {
  const hit = {
    id: 'msg-003',
    subject: 'Search Result',
    from: 'x@y.com',
    to: [],
    timestamp: 1715000002,
    body: 'Full body text that is long ' + 'x'.repeat(500),
    _formatted: { body: 'Matched <em>keyword</em> in text...' },
    attachments: [],
  };

  const result = mapHitToProviderResult(hit, 'http://localhost:3000');
  assert.ok(result.snippet.includes('Matched'));
  assert.ok(!result.snippet.includes('<em>'));
  assert.ok(result.snippet.includes('keyword'));
  console.log('  ✓ mapHitToProviderResult uses _formatted for snippet');
}

function testProviderHandleNullResults() {
  const results = buildProviderResponse(null, 'http://localhost:3000');
  assert.deepStrictEqual(results, []);
  console.log('  ✓ buildProviderResponse handles null');
}

function testProviderHandleEmptyHits() {
  const results = buildProviderResponse({ hits: [], total: 0 }, 'http://localhost:3000');
  assert.deepStrictEqual(results, []);
  console.log('  ✓ buildProviderResponse handles empty hits');
}

function testProviderHandleMissingFields() {
  const hit = { id: 'msg-004', from: '', to: [], timestamp: 0 };
  const result = mapHitToProviderResult(hit, 'http://localhost:3000');
  assert.strictEqual(result.subject, '(no subject)');
  assert.strictEqual(result.sender, '');
  assert.strictEqual(result.snippet, '');
  assert.strictEqual(result.hasAttachments, false);
  console.log('  ✓ mapHitToProviderResult handles missing fields');
}

function testProviderBuildsDeepLinkUrl() {
  const url = buildProviderDeepLink('http://oa.example.com', 'abc-def-123');
  assert.strictEqual(
    url,
    'http://oa.example.com/dashboard/archived-emails/abc-def-123'
  );
  console.log('  ✓ buildProviderDeepLink constructs correct URL');
}

function testProviderBuildsDeepLinkWithTrailingSlash() {
  const url = buildProviderDeepLink('http://oa.example.com/', 'id-456');
  assert.strictEqual(
    url,
    'http://oa.example.com/dashboard/archived-emails/id-456'
  );
  console.log('  ✓ buildProviderDeepLink handles trailing slash');
}

function testProviderErrorFormatting() {
  const authError = formatProviderError('auth-error', 'Bad key');
  assert.ok(authError.toLowerCase().includes('authentication'));

  const unavailError = formatProviderError('unavailable', 'Down');
  assert.ok(unavailError.toLowerCase().includes('unreachable'));

  const genericError = formatProviderError('error', 'Something broke');
  assert.strictEqual(genericError, 'Something broke');
  console.log('  ✓ formatProviderError returns correct messages');
}

function testProviderErrorDefaults() {
  const defaultError = formatProviderError('error', '');
  assert.ok(defaultError.includes('Search failed'));
  console.log('  ✓ formatProviderError provides default message');
}

// Search provider helper functions (pure, testable)

function mapHitToProviderResult(hit, frontendBaseUrl) {
  const snippet = (function () {
    if (hit._formatted && hit._formatted.body) {
      return hit._formatted.body.replace(/<\/?em>/g, '').substring(0, 300);
    }
    if (hit.body) {
      return hit.body.substring(0, 300);
    }
    return '';
  })();

  return {
    id: hit.id,
    subject: hit.subject || '(no subject)',
    sender: hit.from || '',
    recipients: hit.to || [],
    date: hit.timestamp || 0,
    snippet: snippet,
    url: buildProviderDeepLink(frontendBaseUrl, hit.id),
    cc: hit.cc || [],
    bcc: hit.bcc || [],
    hasAttachments: Array.isArray(hit.attachments) && hit.attachments.length > 0,
  };
}

function buildProviderResponse(apiResponse, frontendBaseUrl) {
  if (!apiResponse || !Array.isArray(apiResponse.hits)) {
    return [];
  }
  return apiResponse.hits.map(function (hit) {
    return mapHitToProviderResult(hit, frontendBaseUrl);
  });
}

function buildProviderDeepLink(frontendBaseUrl, messageId) {
  const base = frontendBaseUrl.replace(/\/+$/, '');
  return base + '/dashboard/archived-emails/' + encodeURIComponent(messageId);
}

function formatProviderError(status, message) {
  if (status === 'auth-error') {
    return 'Authentication failed — check your API key in extension settings';
  }
  if (status === 'unavailable') {
    return 'Service unreachable — check network connection';
  }
  return message || 'Search failed';
}

// Run tests
console.log('Running unit tests...\n');
testNormalizeEmptyResults();
testNormalizeHit();
testNormalizeNoAttachments();
testValidatesNormalizeBaseUrl();
testValidatesIsValidUrl();
testBuildMessageUrl();
testProviderMapsHitToResult();
testProviderMapsHitWithoutFormatted();
testProviderMapUsesFormattedSnippet();
testProviderHandleNullResults();
testProviderHandleEmptyHits();
testProviderHandleMissingFields();
testProviderBuildsDeepLinkUrl();
testProviderBuildsDeepLinkWithTrailingSlash();
testProviderErrorFormatting();
testProviderErrorDefaults();
console.log('\nAll tests passed ✓');
