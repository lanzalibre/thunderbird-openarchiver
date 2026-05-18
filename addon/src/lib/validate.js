/**
 * Input validation and URL normalization helpers.
 */

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

function requiresHttps(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1';
  } catch {
    return true;
  }
}

function isNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateSearchParams(params) {
  const errors = [];
  if (params.keywords && typeof params.keywords !== 'string') {
    errors.push('keywords must be a string');
  }
  if (params.page !== undefined) {
    const p = parseInt(params.page, 10);
    if (isNaN(p) || p < 1) errors.push('page must be a positive integer');
  }
  if (params.limit !== undefined) {
    const l = parseInt(params.limit, 10);
    if (isNaN(l) || l < 1 || l > 100) errors.push('limit must be between 1 and 100');
  }
  return errors;
}
