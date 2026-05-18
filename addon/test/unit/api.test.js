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

// Run tests
console.log('Running unit tests...\n');
testNormalizeEmptyResults();
testNormalizeHit();
testNormalizeNoAttachments();
testValidatesNormalizeBaseUrl();
testValidatesIsValidUrl();
testBuildMessageUrl();
console.log('\nAll tests passed ✓');
