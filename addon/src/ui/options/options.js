(function () {
  const form = document.getElementById('settingsForm');
  const apiBaseUrl = document.getElementById('apiBaseUrl');
  const frontendBaseUrl = document.getElementById('frontendBaseUrl');
  const apiKey = document.getElementById('apiKey');
  const authToken = document.getElementById('authToken');
  const defaultResultLimit = document.getElementById('defaultResultLimit');
  const defaultDateRangeDays = document.getElementById('defaultDateRangeDays');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusMsg = document.getElementById('statusMessage');

  async function loadSettings() {
    const result = await browser.storage.local.get([
      'oaApiBaseUrl', 'oaFrontendBaseUrl', 'oaApiKey', 'oaAuthToken',
      'oaDefaultResultLimit', 'oaDefaultDateRangeDays',
    ]);
    apiBaseUrl.value = result.oaApiBaseUrl || '';
    frontendBaseUrl.value = result.oaFrontendBaseUrl || '';
    apiKey.value = result.oaApiKey || '';
    authToken.value = result.oaAuthToken || '';
    defaultResultLimit.value = result.oaDefaultResultLimit || '20';
    defaultDateRangeDays.value = result.oaDefaultDateRangeDays || '365';
  }

  function showStatus(message, type) {
    statusMsg.textContent = message;
    statusMsg.className = 'status ' + type;
    statusMsg.hidden = false;
    setTimeout(() => { statusMsg.hidden = true; }, 8000);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const apiBase = normalizeBaseUrl(apiBaseUrl.value);
    const frontBase = normalizeBaseUrl(frontendBaseUrl.value);

    if (!isValidUrl(apiBase)) {
      showStatus('Invalid API Base URL', 'error');
      return;
    }
    if (!isValidUrl(frontBase)) {
      showStatus('Invalid Web UI Base URL', 'error');
      return;
    }

    await browser.storage.local.set({
      oaApiBaseUrl: apiBase,
      oaFrontendBaseUrl: frontBase,
      oaApiKey: apiKey.value.trim(),
      oaAuthToken: authToken.value.trim(),
      oaDefaultResultLimit: parseInt(defaultResultLimit.value, 10) || 20,
      oaDefaultDateRangeDays: parseInt(defaultDateRangeDays.value, 10) || 365,
    });

    showStatus('Settings saved', 'success');
  });

  testBtn.addEventListener('click', async () => {
    const apiBase = normalizeBaseUrl(apiBaseUrl.value);
    if (!isValidUrl(apiBase)) {
      showStatus('Enter a valid API Base URL first', 'error');
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    showStatus('Testing connection...', 'info');

    try {
      const result = await browser.runtime.sendMessage({ action: 'testConnection' });
      if (result.error) {
        showStatus(result.error, 'error');
      } else if (result.ok) {
        showStatus(result.message, 'success');
      } else {
        showStatus(result.message, 'error');
      }
    } catch (err) {
      showStatus('Could not reach background script: ' + err.message, 'error');
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
    }
  });

  clearBtn.addEventListener('click', async () => {
    if (!confirm('Remove all saved credentials and settings?')) return;
    await browser.storage.local.remove([
      'oaApiBaseUrl', 'oaFrontendBaseUrl', 'oaApiKey', 'oaAuthToken',
      'oaDefaultResultLimit', 'oaDefaultDateRangeDays',
    ]);
    loadSettings();
    showStatus('All credentials removed', 'success');
  });

  loadSettings();
})();
