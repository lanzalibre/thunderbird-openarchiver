/**
 * Normalizes Open Archiver API responses into a stable internal format.
 */

function normalizeSearchResults(apiResponse) {
  if (!apiResponse || !Array.isArray(apiResponse.hits)) {
    return {
      results: [],
      total: 0,
      page: 1,
      totalPages: 0,
    };
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
  const timestamp = hit.timestamp ? hit.timestamp * 1000 : null;

  return {
    id: hit.id,
    subject: hit.subject || '',
    from: hit.from || '',
    to: hit.to || [],
    cc: hit.cc || [],
    bcc: hit.bcc || [],
    date: timestamp ? new Date(timestamp).toISOString() : null,
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
    const truncated = withoutEmTags.length > 200
      ? withoutEmTags.substring(0, 200) + '...'
      : withoutEmTags;
    return truncated;
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
