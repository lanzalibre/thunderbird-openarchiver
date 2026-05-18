/**
 * Custom error types for the extension.
 */

class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function getUserFriendlyMessage(error) {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'AUTH_ERROR':
        return 'Authentication failed. Check your API key or token.';
      case 'PERMISSION_ERROR':
        return 'Your API key does not have the required search:archive permission.';
      case 'RATE_LIMIT':
        return 'Too many requests. Please wait and try again.';
      default:
        return error.message || 'An API error occurred.';
    }
  }
  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return 'Request timed out. Check that the server is reachable.';
  }
  if (error.message && error.message.includes('Failed to fetch')) {
    return 'Could not reach the server. Check the URL and your network connection.';
  }
  return error.message || 'An unexpected error occurred.';
}
