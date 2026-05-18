/**
 * Auth and configuration helpers.
 * Manages reading/writing settings from browser.storage.local.
 */

const STORAGE_KEYS = {
  apiBaseUrl: 'oaApiBaseUrl',
  frontendBaseUrl: 'oaFrontendBaseUrl',
  apiKey: 'oaApiKey',
  authToken: 'oaAuthToken',
  defaultResultLimit: 'oaDefaultResultLimit',
  defaultDateRangeDays: 'oaDefaultDateRangeDays',
};

async function getSettings() {
  const result = await browser.storage.local.get(Object.values(STORAGE_KEYS));
  return {
    apiBaseUrl: result[STORAGE_KEYS.apiBaseUrl] || '',
    frontendBaseUrl: result[STORAGE_KEYS.frontendBaseUrl] || '',
    apiKey: result[STORAGE_KEYS.apiKey] || '',
    authToken: result[STORAGE_KEYS.authToken] || '',
    defaultResultLimit: parseInt(result[STORAGE_KEYS.defaultResultLimit] || '20', 10),
    defaultDateRangeDays: parseInt(result[STORAGE_KEYS.defaultDateRangeDays] || '365', 10),
  };
}

async function saveSettings(settings) {
  const data = {};
  if (settings.apiBaseUrl !== undefined) data[STORAGE_KEYS.apiBaseUrl] = settings.apiBaseUrl;
  if (settings.frontendBaseUrl !== undefined) data[STORAGE_KEYS.frontendBaseUrl] = settings.frontendBaseUrl;
  if (settings.apiKey !== undefined) data[STORAGE_KEYS.apiKey] = settings.apiKey;
  if (settings.authToken !== undefined) data[STORAGE_KEYS.authToken] = settings.authToken;
  if (settings.defaultResultLimit !== undefined) data[STORAGE_KEYS.defaultResultLimit] = settings.defaultResultLimit;
  if (settings.defaultDateRangeDays !== undefined) data[STORAGE_KEYS.defaultDateRangeDays] = settings.defaultDateRangeDays;
  await browser.storage.local.set(data);
}

async function clearSettings() {
  await browser.storage.local.remove(Object.values(STORAGE_KEYS));
}
