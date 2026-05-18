/**
 * Message router between UI components and background scripts.
 * Handles requests from the search panel, options page, and popup.
 */

browser.runtime.onMessage.addListener(async (message, sender) => {
  switch (message.action) {
    case 'search': {
      const settings = await getSettings();
      if (!settings.apiBaseUrl) {
        return { error: 'Open Archiver URL not configured. Open add-on preferences.' };
      }
      const authToken = settings.authToken || undefined;
      const apiKey = settings.apiKey || undefined;
      try {
        const results = await searchArchive({
          apiBaseUrl: settings.apiBaseUrl,
          apiKey,
          authToken,
          ...message.params,
        });
        return { results };
      } catch (err) {
        return { error: err.message };
      }
    }

    case 'testConnection': {
      const settings = await getSettings();
      if (!settings.apiBaseUrl) {
        return { error: 'Open Archiver URL not configured.' };
      }
      const authToken = settings.authToken || undefined;
      const apiKey = settings.apiKey || undefined;
      return testConnection({ apiBaseUrl: settings.apiBaseUrl, apiKey, authToken });
    }

    case 'getSettings':
      return getSettings();

    case 'saveSettings':
      await saveSettings(message.settings);
      return { ok: true };

    case 'clearSettings':
      await clearSettings();
      return { ok: true };

    default:
      return { error: `Unknown action: ${message.action}` };
  }
});
