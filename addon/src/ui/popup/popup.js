(function () {
  const openPanelBtn = document.getElementById('openPanelBtn');
  const openOptionsBtn = document.getElementById('openOptionsBtn');
  const statusText = document.getElementById('statusText');

  openPanelBtn.addEventListener('click', () => {
    browser.sidebarAction.open();
    window.close();
  });

  openOptionsBtn.addEventListener('click', () => {
    browser.runtime.openOptionsPage();
    window.close();
  });

  browser.storage.local.get(['oaApiBaseUrl', 'oaFrontendBaseUrl', 'oaApiKey', 'oaAuthToken'])
    .then((result) => {
      const hasApi = result.oaApiBaseUrl && (result.oaApiKey || result.oaAuthToken);
      const hasFront = result.oaFrontendBaseUrl;
      if (hasApi && hasFront) {
        statusText.textContent = 'Configured ✓';
        statusText.className = 'status ok';
      } else if (hasApi) {
        statusText.textContent = 'Need Web UI URL';
        statusText.className = 'status warn';
      } else {
        statusText.textContent = 'Not configured';
        statusText.className = 'status';
      }
    });
})();
