(function () {
  var PROVIDER_NAME = "openarchiver";
  var registered = false;
  var retryCount = 0;
  var maxRetries = 10;
  var debounceTimer = null;
  var activeAbortController = null;
  var signalListeners = [];

  try { console.log("OA: background search-provider.js loaded, browser=" + (typeof browser) + ", searchProviders=" + (browser && browser.searchProviders ? "yes" : "no")); } catch(e) {}

  function init() {
    if (
      typeof browser !== "undefined" &&
      browser.searchProviders
    ) {
      try { console.log("OA: browser.searchProviders available, registering..."); } catch(e) {}
      registerProvider();
    } else if (retryCount < maxRetries) {
      retryCount++;
      setTimeout(init, 500 * retryCount);
    } else {
      try {
        browser.notifications.create("search-provider-error", {
          type: "basic",
          title: "Open Archiver Search",
          message:
            "Search provider API not available. Try reloading the add-on.",
        });
      } catch (e) {}
    }
  }

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
      registered = false;
      retryCount++;
      if (retryCount < maxRetries) {
        setTimeout(init, 500 * retryCount);
      }
      return;
    }

    browser.searchProviders.onSearchRequest.addListener(
      debounceRequest
    );
  }

  function debounceRequest(request) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    if (activeAbortController) {
      activeAbortController.abort();
    }

    var capturedRequest = JSON.parse(JSON.stringify(request));

    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      handleSearchRequest(capturedRequest);
    }, 300);
  }

  async function handleSearchRequest(request) {
    activeAbortController = new AbortController();
    var signal = activeAbortController.signal;

    try {
      var settings;
      try {
        settings = await getSettings();
      } catch (e) {
        trySendError(
          request.queryId,
          "error",
          "Could not read extension settings."
        );
        return;
      }

      if (!settings.apiBaseUrl) {
        trySendError(
          request.queryId,
          "unavailable",
          "Open Archiver URL not configured. Open add-on preferences."
        );
        return;
      }

      if (!settings.apiKey && !settings.authToken) {
        trySendError(
          request.queryId,
          "auth-error",
          "Authentication not configured. Set an API key or auth token in extension preferences."
        );
        return;
      }

      var frontendBaseUrl =
        settings.frontendBaseUrl || settings.apiBaseUrl;
      var emlTemplate = settings.emlPathTemplate || "";

      var apiResponse = await fetchWithRetry(
        settings.apiBaseUrl,
        settings.apiKey || "",
        settings.authToken || "",
        request,
        signal
      );

      if (signal.aborted) return;

      if (
        !apiResponse ||
        !Array.isArray(apiResponse.hits)
      ) {
        trySendResults(request.queryId, {
          results: [],
          totalCount: 0,
        });
        return;
      }

      var mapped = apiResponse.hits.map(function (hit) {
        return mapHitToResult(hit, frontendBaseUrl);
      });

      if (signal.aborted) return;

      // Fetch storagePath for each hit in parallel
      var storagePaths = await Promise.all(
        mapped.map(async function (result) {
          try {
            var detail = await fetchArchivedEmail(
              settings.apiBaseUrl,
              settings.apiKey || "",
              settings.authToken || "",
              result.id,
              signal
            );
            return detail && detail.storagePath ? detail.storagePath : "";
          } catch (e) {
            return "";
          }
        })
      );

      if (signal.aborted) return;

      // Attach localEmlPath to each result
      for (var i = 0; i < mapped.length; i++) {
        if (storagePaths[i] && emlTemplate) {
          mapped[i].localEmlPath = emlTemplate.replace(
            /\{storagePath\}/g,
            storagePaths[i]
          );
        }
      }

      trySendResults(request.queryId, {
        results: mapped,
        totalCount: apiResponse.total || mapped.length,
      });
    } catch (err) {
      if (err.name === "AbortError" || signal.aborted) return;

      var errorInfo = classifyError(err);
      trySendError(
        request.queryId,
        errorInfo.status,
        errorInfo.message
      );
    } finally {
      if (
        activeAbortController &&
        !activeAbortController.signal.aborted
      ) {
        activeAbortController = null;
      }
      cleanupSignalListeners();
    }
  }

  function trySendResults(queryId, response) {
    try {
      console.log("OA: sendResults queryId=" + queryId + " results=" + (response && response.results ? response.results.length : 0));
      browser.searchProviders.sendResults(queryId, response);
    } catch (e) {
      console.log("OA: sendResults error: " + (e.message || e));
    }
  }

  function trySendError(queryId, status, message) {
    try {
      console.log("OA: sendError queryId=" + queryId + " status=" + status + " msg=" + message);
      browser.searchProviders.sendError(queryId, status, message);
    } catch (e) {
      console.log("OA: sendError exception: " + (e.message || e));
    }
  }

  async function fetchWithRetry(
    apiBaseUrl,
    apiKey,
    authToken,
    request,
    signal
  ) {
    var maxRetries = 1;
    var attempt = 0;

    while (attempt <= maxRetries) {
      attempt++;

      try {
        return await executeSearch(
          apiBaseUrl,
          apiKey,
          authToken,
          request,
          signal
        );
      } catch (err) {
        if (signal.aborted) throw err;

        if (
          attempt <= maxRetries &&
          isNetworkError(err)
        ) {
          continue;
        }

        if (err.message && err.message.indexOf("429") !== -1) {
          var retryAfter = extractRetryAfter(err);
          if (retryAfter > 0) {
            await sleep(Math.min(retryAfter * 1000, 10000));
            continue;
          }
        }

        throw err;
      }
    }

    throw new Error(
      "Search failed after " + maxRetries + " retries"
    );
  }

  async function executeSearch(
    apiBaseUrl,
    apiKey,
    authToken,
    request,
    signal
  ) {
    var baseUrl = apiBaseUrl.replace(/\/+$/, "");
    var url = new URL(baseUrl + "/v1/search");
    var params = new URLSearchParams();

    if (request.searchString) {
      params.set("keywords", request.searchString);
    }
    params.set(
      "page",
      String(
        Math.floor(
          (request.offset || 0) / (request.limit || 10)
        ) + 1
      )
    );
    params.set("limit", String(request.limit || 10));

    if (request.filters) {
      if (request.filters.sender) {
        params.set("from", request.filters.sender);
      }
      if (request.filters.recipient) {
        params.set("to", request.filters.recipient);
      }
      if (request.filters.recipientCc) {
        params.set("cc", request.filters.recipientCc);
      }
      if (request.filters.recipientBcc) {
        params.set("bcc", request.filters.recipientBcc);
      }
      if (request.filters.dateFrom) {
        params.set(
          "dateFrom",
          String(request.filters.dateFrom)
        );
      }
      if (request.filters.dateTo) {
        params.set(
          "dateTo",
          String(request.filters.dateTo)
        );
      }
    }

    url.search = params.toString();

    var headers = {
      Accept: "application/json",
    };
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    } else if (authToken) {
      headers["Authorization"] = "Bearer " + authToken;
    }

    var combinedSignal = combineSignals(
      signal,
      AbortSignal.timeout(5000)
    );

    var response = await fetch(url.toString(), {
      headers: headers,
      signal: combinedSignal,
    });

    if (response.status === 401) {
      throw new Error(
        "HTTP 401: Unauthorized — check API key"
      );
    }
    if (response.status === 403) {
      throw new Error(
        "HTTP 403: Forbidden — check search:archive permission"
      );
    }
    if (response.status === 429) {
      var retryAfter =
        response.headers.get("Retry-After") || "5";
      throw new Error(
        "HTTP 429: Rate limited. Retry-After: " + retryAfter
      );
    }
    if (!response.ok) {
      var body;
      try {
        body = await response.json();
      } catch (e) {
        body = {};
      }
      throw new Error(
        "HTTP " +
          response.status +
          ": " +
          (body.message ||
            response.statusText ||
            "Unknown error")
      );
    }

    return response.json();
  }

  async function fetchArchivedEmail(
    apiBaseUrl,
    apiKey,
    authToken,
    emailId,
    signal
  ) {
    try {
      var baseUrl = apiBaseUrl.replace(/\/+$/, "");
      var url = baseUrl + "/v1/archived-emails/" + encodeURIComponent(emailId);
      var headers = { Accept: "application/json" };
      if (apiKey) {
        headers["X-API-Key"] = apiKey;
      } else if (authToken) {
        headers["Authorization"] = "Bearer " + authToken;
      }
      var combinedSignal = combineSignals(
        signal,
        AbortSignal.timeout(3000)
      );
      var response = await fetch(url, {
        headers: headers,
        signal: combinedSignal,
      });
      if (!response.ok) return null;
      return response.json();
    } catch (e) {
      return null;
    }
  }

  function mapHitToResult(hit, frontendBaseUrl) {
    var snippet = "";
    if (hit._formatted && hit._formatted.body) {
      snippet = hit._formatted.body
        .replace(/<\/?em>/g, "")
        .substring(0, 300);
    } else if (hit.body) {
      snippet = hit.body.substring(0, 300);
    }

    var baseUrl = frontendBaseUrl.replace(/\/+$/, "");

    return {
      id: hit.id,
      subject: hit.subject || "(no subject)",
      sender: hit.from || "",
      recipients: hit.to || [],
      date: hit.timestamp || 0,
      snippet: snippet,
      url:
        baseUrl +
        "/dashboard/archived-emails/" +
        encodeURIComponent(hit.id),
      cc: hit.cc || [],
      bcc: hit.bcc || [],
      hasAttachments:
        Array.isArray(hit.attachments) &&
        hit.attachments.length > 0,
    };
  }

  function classifyError(err) {
    var msg = (err && err.message) || "";
    var lower = msg.toLowerCase();

    if (
      msg.indexOf("401") !== -1 ||
      msg.indexOf("unauthorized") !== -1
    ) {
      return {
        status: "auth-error",
        message:
          "Authentication failed — check your API key or token in extension preferences.",
      };
    }

    if (
      msg.indexOf("403") !== -1 ||
      msg.indexOf("forbidden") !== -1
    ) {
      return {
        status: "auth-error",
        message:
          "Access denied — your API key may lack the search:archive permission.",
      };
    }

    if (
      msg.indexOf("429") !== -1 ||
      msg.indexOf("rate limit") !== -1
    ) {
      return {
        status: "error",
        message:
          "Rate limited by Open Archiver — please wait and try again.",
      };
    }

    if (
      msg.indexOf("fetch") !== -1 ||
      msg.indexOf("network") !== -1 ||
      msg.indexOf("failed") !== -1
    ) {
      return {
        status: "unavailable",
        message:
          "Could not reach Open Archiver — check the server URL and network connection.",
      };
    }

    if (
      msg.indexOf("timeout") !== -1 ||
      msg.indexOf("timed out") !== -1
    ) {
      return {
        status: "unavailable",
        message:
          "Open Archiver did not respond in time (5s timeout).",
      };
    }

    return {
      status: "error",
      message: msg || "Search failed.",
    };
  }

  function isNetworkError(err) {
    var msg = (err && err.message) || "";
    return (
      msg.indexOf("fetch") !== -1 ||
      msg.indexOf("network") !== -1 ||
      msg.indexOf("Failed to fetch") !== -1 ||
      msg.indexOf("TypeError") !== -1
    );
  }

  function extractRetryAfter(err) {
    try {
      var parts = err.message.split("Retry-After: ");
      if (parts.length > 1) {
        return parseInt(parts[1], 10) || 5;
      }
    } catch (e) {}
    return 5;
  }

  function combineSignals(signal1, signal2) {
    var controller = new AbortController();

    function onAbort() {
      controller.abort();
      cleanupSignalListeners();
    }

    signal1.addEventListener("abort", onAbort);
    signal2.addEventListener("abort", onAbort);

    signalListeners.push(
      { signal: signal1, listener: onAbort },
      { signal: signal2, listener: onAbort }
    );

    if (signal1.aborted || signal2.aborted) {
      controller.abort();
    }

    return controller.signal;
  }

  function cleanupSignalListeners() {
    while (signalListeners.length > 0) {
      var entry = signalListeners.pop();
      try {
        entry.signal.removeEventListener("abort", entry.listener);
      } catch (e) {}
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  init();
})();
