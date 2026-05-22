"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { MailUtils } = ChromeUtils.importESModule(
  "resource:///modules/MailUtils.sys.mjs"
);

var cls = class extends ExtensionAPI {
  getAPI(context) {
    let searchEventFire = null;
    const providers = new Map();
    let hookInstalled = false;

    function setupKeypressHook() {
      if (hookInstalled) return;
      try {
        var win =
          Services.wm.getMostRecentWindow("mail:3pane");
        if (!win || !win.document) {
          setTimeout(setupKeypressHook, 2000);
          return;
        }

        win.addEventListener(
          "keypress",
          function (event) {
            if (event.key !== "Enter") return;
            var el = event.target;
            if (!el || !el.value) return;

            var isSearch =
              el.id === "searchInput" ||
              el.id === "search-box" ||
              (el.localName === "textbox" &&
                el.getAttribute("type") === "search") ||
              (el.localName === "search-textbox") ||
              (el.localName === "input" &&
                el.getAttribute("type") === "search") ||
              el.localName === "global-search-bar" ||
              (el.classList &&
                el.classList.contains(
                  "remote-gloda-search"
                ));

            if (!isSearch) {
              Services.console.logStringMessage(
                "searchProviders: keypress on non-search element: " +
                  el.localName + "#" + (el.id || "") + "." + (el.className || "")
              );
              return;
            }

            var queryId =
              "oa-" +
              Date.now() +
              "-" +
              Math.random().toString(36).slice(2, 8);

            if (searchEventFire) {
              Services.console.logStringMessage(
                "searchProviders: dispatching queryId=" + queryId + " search=" + el.value
              );
              searchEventFire
                .async({
                  queryId: queryId,
                  searchString: el.value,
                  offset: 0,
                  limit: 10,
                  filters: {},
                })
                .then(function () {
                  Services.console.logStringMessage(
                    "searchProviders: dispatch completed for " + queryId
                  );
                })
                .catch(function (err) {
                  Services.console.logStringMessage(
                    "searchProviders: dispatch error for " + queryId + ": " + (err.message || err)
                  );
                });
            } else {
              Services.console.logStringMessage(
                "searchProviders: searchEventFire is null for query=" + el.value
              );
            }
          },
          true
        );
        hookInstalled = true;
      } catch (e) {
        Services.console.logStringMessage(
          "searchProviders: hook error: " + (e.message || e)
        );
      }
    }

    function getFacetDocument() {
      try {
        var win =
          Services.wm.getMostRecentWindow("mail:3pane");
        if (!win) {
          Services.console.logStringMessage("searchProviders: no mail:3pane window");
          return null;
        }
        var tabmail = win.document.getElementById("tabmail");
        if (!tabmail) {
          Services.console.logStringMessage("searchProviders: no tabmail");
          return null;
        }
        var tabInfo = tabmail.currentTabInfo;
        if (!tabInfo) {
          Services.console.logStringMessage("searchProviders: no current tab");
          return null;
        }
        var mode = tabInfo.mode ? tabInfo.mode.type : "unknown";
        if (mode !== "glodaFacet" && mode !== "glodaSearch") {
          Services.console.logStringMessage("searchProviders: tab mode is " + mode + " not glodaFacet/glodaSearch");
          return null;
        }
        var browser = tabInfo.browser;
        if (!browser) {
          Services.console.logStringMessage("searchProviders: no browser in " + mode + " tab");
          return null;
        }
        var doc = browser.contentDocument || (browser.document && browser.document.getElementById("content") && browser.document.getElementById("content").contentDocument);
        if (!doc) {
          Services.console.logStringMessage("searchProviders: no contentDocument in " + mode + " tab");
          return null;
        }
        return doc;
      } catch (e) {
        Services.console.logStringMessage("searchProviders: getFacetDocument error: " + e.message);
        return null;
      }
    }

    function injectSection(queryId, response) {
      try {
        var doc = getFacetDocument();
        if (!doc) {
          Services.console.logStringMessage("searchProviders: injectSection no document");
          return;
        }
        Services.console.logStringMessage("searchProviders: injectSection doc=" + (doc.location ? doc.location.href : "no location") + " body=" + (!!doc.body));

        var section = doc.getElementById("oa-search-results");
        if (!section) {
          section = doc.createElement("div");
          section.id = "oa-search-results";
          section.style.cssText =
            "margin:8px;padding:12px;border:1px solid #ccc;" +
            "border-radius:4px;font-family:sans-serif;";

          var header = doc.createElement("h3");
          header.id = "oa-search-header";
          header.style.cssText =
            "margin:0 0 8px 0;font-size:14px;color:#333;";
          section.appendChild(header);

          var list = doc.createElement("div");
          list.id = "oa-results-list";
          section.appendChild(list);

          var resultsContainer =
            doc.getElementById("results") || doc.body;
          if (
            resultsContainer &&
            resultsContainer.parentNode
          ) {
            resultsContainer.parentNode.insertBefore(
              section,
              resultsContainer
            );
            Services.console.logStringMessage("searchProviders: injectSection section inserted before results");
          } else {
            doc.body.appendChild(section);
            Services.console.logStringMessage("searchProviders: injectSection section appended to body");
          }
        }

        var header = doc.getElementById("oa-search-header");
        var providerNames =
          Array.from(providers.keys()).join(", ");
        header.textContent =
          (response.results ? response.results.length : 0) +
          " results from " +
          providerNames;

        var list = doc.getElementById("oa-results-list");
        list.innerHTML = "";

        if (
          !response.results ||
          response.results.length === 0
        ) {
          list.textContent = "No results from external providers.";
          return;
        }

        for (var i = 0; i < response.results.length; i++) {
          var result = response.results[i];
          var item = doc.createElement("div");
          item.style.cssText =
            "padding:6px 0;border-bottom:1px solid #eee;cursor:pointer;";

          var subjectEl = doc.createElement("span");
          subjectEl.style.cssText =
            "font-weight:bold;font-size:13px;color:#1a73e8;display:block;";
          subjectEl.textContent =
            result.subject || "(no subject)";
          item.appendChild(subjectEl);

          var metaEl = doc.createElement("span");
          metaEl.style.cssText =
            "font-size:11px;color:#666;display:flex;gap:12px;";
          metaEl.textContent =
            (result.sender || "") +
            " — " +
            (result.date
              ? new Date(
                  result.date * 1000
                ).toLocaleDateString()
              : "");
          item.appendChild(metaEl);

          if (result.snippet) {
            var snippetEl = doc.createElement("span");
            snippetEl.style.cssText =
              "font-size:12px;color:#555;display:block;";
            snippetEl.textContent = result.snippet;
            item.appendChild(snippetEl);
          }

          var resultUrl = result.url;
          var storagePath = result.storagePath;
          var apiBaseUrl = result.apiBaseUrl;
          var apiKey = result.apiKey;
          (function (url_0, spath, apibase, apikey) {
            item.addEventListener("click", async function () {
              if (spath && apibase) {
                try {
                  var downloadUrl =
                    apibase.replace(/\/+$/, "") +
                    "/v1/storage/download?path=" +
                    encodeURIComponent(spath);
                  var resp = await fetch(downloadUrl, {
                    headers: apikey
                      ? { "X-API-Key": apikey }
                      : { Accept: "application/octet-stream" },
                    signal: AbortSignal.timeout(15000),
                  });
                  if (!resp.ok) throw new Error("HTTP " + resp.status);
                  var buf = await resp.arrayBuffer();

                  var tmpDir = Services.dirsvc.get(
                    "TmpD",
                    Ci.nsIFile
                  );
                  var tmpFile = tmpDir.clone();
                  tmpFile.append(
                    "oa-" +
                      Date.now() +
                      "-" +
                      Math.random().toString(36).slice(2, 8) +
                      ".eml"
                  );

                  var stream = Cc[
                    "@mozilla.org/network/file-output-stream;1"
                  ].createInstance(Ci.nsIFileOutputStream);
                  stream.init(
                    tmpFile,
                    0x02 | 0x08 | 0x20,
                    0o666,
                    0
                  );
                  var bytes = new Uint8Array(buf);
                  stream.write(bytes, bytes.length);
                  stream.close();

                  var win =
                    Services.wm.getMostRecentWindow(
                      "mail:3pane"
                    );
                  if (win) {
                    var fileUri = Services.io
                      .getProtocolHandler("file")
                      .QueryInterface(
                        Ci.nsIFileProtocolHandler
                      )
                      .newFileURI(tmpFile);
                    MailUtils.openEMLFile(win, tmpFile, fileUri);
                    return;
                  }
                } catch (e) {
                  Services.console.logStringMessage(
                    "searchProviders: downloadEml error: " +
                      (e.message || e)
                  );
                }
              }
              if (url_0) {
                try {
                  var ep = Cc[
                    "@mozilla.org/uriloader/external-protocol-service;1"
                  ].getService(Ci.nsIExternalProtocolService);
                  ep.loadURI(
                    Services.io.newURI(url_0, null, null)
                  );
                } catch (e) {
                  Services.console.logStringMessage(
                    "searchProviders: openUrl error: " +
                      (e.message || e)
                  );
                }
              }
            });
          })(resultUrl, storagePath, apiBaseUrl, apiKey);

          list.appendChild(item);
        }
      } catch (e) {
        Services.console.logStringMessage(
          "searchProviders: injectSection error: " +
            e.message
        );
      }
    }

    function injectError(queryId, status, message) {
      try {
        var doc = getFacetDocument();
        if (!doc) return;

        var section = doc.getElementById("oa-search-results");
        if (!section) {
          section = doc.createElement("div");
          section.id = "oa-search-results";
          section.style.cssText =
            "margin:8px;padding:12px;border:1px solid #e88;" +
            "border-radius:4px;background:#fff5f5;" +
            "font-family:sans-serif;";

          var header = doc.createElement("h3");
          header.id = "oa-search-header";
          header.style.cssText =
            "margin:0 0 8px 0;font-size:14px;color:#c33;";
          section.appendChild(header);

          var resultsContainer =
            doc.getElementById("results") || doc.body;
          if (
            resultsContainer &&
            resultsContainer.parentNode
          ) {
            resultsContainer.parentNode.insertBefore(
              section,
              resultsContainer
            );
          } else {
            doc.body.appendChild(section);
          }
        }

        var header = doc.getElementById("oa-search-header");
        if (status === "auth-error") {
          header.textContent =
            "Authentication failed — check your API key in extension settings";
        } else if (status === "unavailable") {
          header.textContent =
            "Service unavailable — check network connection";
        } else {
          header.textContent =
            message || "Search provider error";
        }

        var list = doc.getElementById("oa-results-list");
        if (list) {
          list.innerHTML = "";
        }
      } catch (e) {
        Services.console.logStringMessage(
          "searchProviders: injectError error: " + e.message
        );
      }
    }

    return {
      searchProviders: {
        async register(name, options) {
          providers.set(name, {
            name: name,
            label: options.label,
            ...options,
          });
          setupKeypressHook();
        },

        async unregister(name) {
          providers.delete(name);
        },

        sendResults(queryId, response) {
          injectSection(queryId, response);
        },

        sendError(queryId, status, message) {
          injectError(queryId, status, message);
        },

        onSearchRequest: new ExtensionCommon.EventManager({
          context,
          name: "searchProviders.onSearchRequest",
          register: function (fire) {
            Services.console.logStringMessage(
              "searchProviders: EventManager register called, fire=" + (typeof fire)
            );
            searchEventFire = fire;
            return function () {
              Services.console.logStringMessage(
                "searchProviders: EventManager unregister called"
              );
              searchEventFire = null;
            };
          },
        }).api(),
      },
    };
  }
};

this.searchProvider = cls;
this.searchProviders = cls;
