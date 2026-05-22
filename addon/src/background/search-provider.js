(function () {
  const PROVIDER_NAME = "openarchiver";
  let registered = false;

  async function registerProvider() {
    if (registered) return;
    registered = true;

    try {
      await browser.searchProviders.register(PROVIDER_NAME, {
        label: "Open Archiver Archive",
        icon: "assets/icon-32.svg",
        defaultQueryLimit: 10,
        timeoutMs: 5000,
      });
    } catch (e) {
      return;
    }

    browser.searchProviders.onSearchRequest.addListener(handleSearchRequest);
  }

  async function handleSearchRequest(request) {
    try {
      const settings = await getSettings();
      if (!settings.apiBaseUrl) {
        browser.searchProviders.sendError(
          request.queryId,
          "unavailable",
          "Open Archiver URL not configured. Open add-on preferences."
        );
        return;
      }

      const apiKey = settings.apiKey || "";
      const authToken = settings.authToken || "";
      if (!apiKey && !authToken) {
        browser.searchProviders.sendError(
          request.queryId,
          "auth-error",
          "No API key configured. Open add-on preferences."
        );
        return;
      }

      const frontendBaseUrl = settings.frontendBaseUrl || settings.apiBaseUrl;

      const results = await fetchSearchResults(
        settings.apiBaseUrl,
        apiKey,
        authToken,
        request
      );

      const mapped = results.hits.map(function (hit) {
        const snippet = hit._formatted && hit._formatted.body
          ? hit._formatted.body.replace(/<\/?em>/g, "").substring(0, 300)
          : hit.body
            ? hit.body.substring(0, 300)
            : "";

        return {
          id: hit.id,
          subject: hit.subject || "(no subject)",
          sender: hit.from || "",
          recipients: hit.to || [],
          date: hit.timestamp || 0,
          snippet: snippet,
          url: (frontendBaseUrl.replace(/\/+$/, "")) +
            "/dashboard/archived-emails/" +
            encodeURIComponent(hit.id),
          cc: hit.cc || [],
          bcc: hit.bcc || [],
          hasAttachments: Array.isArray(hit.attachments) && hit.attachments.length > 0,
        };
      });

      browser.searchProviders.sendResults(request.queryId, {
        results: mapped,
        totalCount: results.total || mapped.length,
      });
    } catch (err) {
      if (err.name === "AbortError") return;

      if (err.message && err.message.includes("Failed to fetch")) {
        browser.searchProviders.sendError(
          request.queryId,
          "unavailable",
          "Could not reach Open Archiver. Check URL and network."
        );
      } else if (
        err.message &&
        (err.message.includes("401") || err.message.includes("Unauthorized"))
      ) {
        browser.searchProviders.sendError(
          request.queryId,
          "auth-error",
          "Authentication failed. Check API key in extension settings."
        );
      } else {
        browser.searchProviders.sendError(
          request.queryId,
          "error",
          err.message || "Search failed"
        );
      }
    }
  }

  async function fetchSearchResults(apiBaseUrl, apiKey, authToken, request) {
    const url = new URL(apiBaseUrl.replace(/\/+$/, "") + "/v1/search");
    const params = new URLSearchParams();

    if (request.searchString) {
      params.set("keywords", request.searchString);
    }
    params.set("page", String(Math.floor((request.offset || 0) / (request.limit || 10)) + 1));
    params.set("limit", String(request.limit || 10));

    if (request.filters) {
      if (request.filters.sender) params.set("from", request.filters.sender);
      if (request.filters.recipient) params.set("to", request.filters.recipient);
      if (request.filters.dateFrom) params.set("dateFrom", String(request.filters.dateFrom));
      if (request.filters.dateTo) params.set("dateTo", String(request.filters.dateTo));
    }

    url.search = params.toString();

    const headers = {};
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    } else if (authToken) {
      headers["Authorization"] = "Bearer " + authToken;
    }
    headers["Accept"] = "application/json";

    const response = await fetch(url.toString(), {
      headers: headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(
        "HTTP " + response.status + ": " + response.statusText
      );
    }

    return response.json();
  }

  if (typeof browser !== "undefined" && browser.searchProviders) {
    registerProvider();
  }
})();
