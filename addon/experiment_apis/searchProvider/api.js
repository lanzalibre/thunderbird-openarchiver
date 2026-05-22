"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { Services } = ChromeUtils.importESModule(
  "resource://gre/modules/Services.sys.mjs"
);

this.searchProviders = class extends ExtensionAPI {
  getAPI(context) {
    let searchEventFire = null;
    const providers = new Map();
    let hookInstalled = false;
    let patchedSearcher = false;
    let originalGetCollection = null;
    let searchInputListener = null;

    function installHook() {
      if (hookInstalled) return;
      hookInstalled = true;

      // Strategy 1: Monkeypatch GlodaMsgSearcher (works if import path is correct)
      tryPatchGloda();

      // Strategy 2: DOM-level search bar interception (always works)
      tryInstallDomHook();
    }

    function tryPatchGloda() {
      try {
        const { GlodaMsgSearcher } = ChromeUtils.importESModule(
          "resource:///modules/gloda/GlodaMsgSearcher.sys.mjs"
        );
        if (
          GlodaMsgSearcher &&
          GlodaMsgSearcher.prototype &&
          GlodaMsgSearcher.prototype.getCollection
        ) {
          originalGetCollection =
            GlodaMsgSearcher.prototype.getCollection;

          GlodaMsgSearcher.prototype.getCollection = function (
            aListener,
            aData
          ) {
            const queryId =
              "oa-" +
              Date.now() +
              "-" +
              Math.random().toString(36).slice(2, 8);

            if (searchEventFire) {
              const searchString =
                this._searchString ||
                (aData && aData.searchString) ||
                "";
              searchEventFire
                .async({
                  queryId,
                  searchString,
                  offset: 0,
                  limit: 10,
                  filters: {},
                })
                .catch(() => {});
            }

            return originalGetCollection.call(this, aListener, aData);
          };

          patchedSearcher = true;
        }
      } catch (e) {
        // Gloda not available via this path — DOM fallback below
      }
    }

    function tryInstallDomHook() {
      try {
        const window =
          Services.wm.getMostRecentWindow("mail:3pane");
        if (!window) {
          // Window not ready — listen for it
          const listener = {
            observe(aSubject, aTopic) {
              if (aTopic === "domwindowopened") {
                // Will be set up when a window is ready
              }
            },
          };
          Services.obs.addObserver(listener, "domwindowopened");
          return;
        }

        const searchInput = window.document.querySelector(
          ".remote-gloda-search, #searchInput, input[type='search']"
        );
        if (searchInput && !searchInputListener) {
          searchInputListener = function (event) {
            if (event.key !== "Enter") return;
            const searchString = searchInput.value;
            if (!searchString) return;

            const queryId =
              "oa-" +
              Date.now() +
              "-" +
              Math.random().toString(36).slice(2, 8);

            if (searchEventFire) {
              searchEventFire
                .async({
                  queryId,
                  searchString,
                  offset: 0,
                  limit: 10,
                  filters: {},
                })
                .catch(() => {});
            }
          };
          searchInput.addEventListener(
            "keypress",
            searchInputListener
          );
        }
      } catch (e) {
        // DOM hook failed — search integration degraded
      }
    }

    function uninstallHook() {
      hookInstalled = false;

      // Restore Gloda patch
      if (patchedSearcher && originalGetCollection) {
        try {
          const { GlodaMsgSearcher } = ChromeUtils.importESModule(
            "resource:///modules/gloda/GlodaMsgSearcher.sys.mjs"
          );
          if (GlodaMsgSearcher) {
            GlodaMsgSearcher.prototype.getCollection =
              originalGetCollection;
          }
        } catch (e) {}
        patchedSearcher = false;
      }

      // Remove DOM listener
      if (searchInputListener) {
        try {
          const window =
            Services.wm.getMostRecentWindow("mail:3pane");
          if (window) {
            const searchInput = window.document.querySelector(
              ".remote-gloda-search, #searchInput, input[type='search']"
            );
            if (searchInput) {
              searchInput.removeEventListener(
                "keypress",
                searchInputListener
              );
            }
          }
        } catch (e) {}
        searchInputListener = null;
      }
    }

    function getFacetDocument() {
      try {
        const window =
          Services.wm.getMostRecentWindow("mail:3pane");
        if (!window) return null;
        const tabmail = window.document.getElementById("tabmail");
        if (!tabmail) return null;
        const tabInfo = tabmail.currentTabInfo;
        if (!tabInfo || tabInfo.mode.type !== "glodaFacet")
          return null;
        const browser = tabInfo.browser;
        if (!browser || !browser.contentDocument) return null;
        return browser.contentDocument;
      } catch (e) {
        return null;
      }
    }

    function injectSection(queryId, response) {
      try {
        const doc = getFacetDocument();
        if (!doc) return;

        let section = doc.getElementById("oa-search-results");
        if (!section) {
          section = doc.createElement("div");
          section.id = "oa-search-results";
          section.style.cssText =
            "margin:8px;padding:12px;border:1px solid #ccc;border-radius:4px;" +
            "font-family:sans-serif;";

          const header = doc.createElement("h3");
          header.id = "oa-search-header";
          header.style.cssText =
            "margin:0 0 8px 0;font-size:14px;color:#333;";
          section.appendChild(header);

          const list = doc.createElement("div");
          list.id = "oa-results-list";
          section.appendChild(list);

          const resultsContainer =
            doc.getElementById("results") || doc.body;
          if (resultsContainer && resultsContainer.parentNode) {
            resultsContainer.parentNode.insertBefore(
              section,
              resultsContainer
            );
          } else {
            doc.body.appendChild(section);
          }
        }

        const header = doc.getElementById("oa-search-header");
        const providerNames =
          Array.from(providers.keys()).join(", ");
        header.textContent =
          (response.results ? response.results.length : 0) +
          " results from " +
          providerNames;

        const list = doc.getElementById("oa-results-list");
        list.innerHTML = "";

        if (
          !response.results ||
          response.results.length === 0
        ) {
          list.textContent = "No results from external providers.";
          return;
        }

        for (const result of response.results) {
          const item = doc.createElement("div");
          item.style.cssText =
            "padding:6px 0;border-bottom:1px solid #eee;cursor:pointer;";

          const subjectEl = doc.createElement("span");
          subjectEl.style.cssText =
            "font-weight:bold;font-size:13px;color:#1a73e8;display:block;";
          subjectEl.textContent =
            result.subject || "(no subject)";
          item.appendChild(subjectEl);

          const metaEl = doc.createElement("span");
          metaEl.style.cssText =
            "font-size:11px;color:#666;display:flex;gap:12px;";
          metaEl.textContent =
            (result.sender || "") +
            " — " +
            (result.date
              ? new Date(result.date * 1000).toLocaleDateString()
              : "");
          item.appendChild(metaEl);

          if (result.snippet) {
            const snippetEl = doc.createElement("span");
            snippetEl.style.cssText =
              "font-size:12px;color:#555;display:block;";
            snippetEl.textContent = result.snippet;
            item.appendChild(snippetEl);
          }

          item.addEventListener("click", function () {
            if (result.url) {
              const win =
                Services.wm.getMostRecentWindow("mail:3pane");
              if (win) {
                win.openLink(result.url);
              }
            }
          });

          list.appendChild(item);
        }
      } catch (e) {
        Services.console.logStringMessage(
          "searchProviders: injectSection error: " + e.message
        );
      }
    }

    function injectError(queryId, status, message) {
      try {
        const doc = getFacetDocument();
        if (!doc) return;

        let section = doc.getElementById("oa-search-results");
        if (!section) {
          section = doc.createElement("div");
          section.id = "oa-search-results";
          section.style.cssText =
            "margin:8px;padding:12px;border:1px solid #e88;" +
            "border-radius:4px;background:#fff5f5;font-family:sans-serif;";

          const header = doc.createElement("h3");
          header.id = "oa-search-header";
          header.style.cssText =
            "margin:0 0 8px 0;font-size:14px;color:#c33;";
          section.appendChild(header);

          const resultsContainer =
            doc.getElementById("results") || doc.body;
          if (resultsContainer && resultsContainer.parentNode) {
            resultsContainer.parentNode.insertBefore(
              section,
              resultsContainer
            );
          } else {
            doc.body.appendChild(section);
          }
        }

        const header = doc.getElementById("oa-search-header");
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

        const list = doc.getElementById("oa-results-list");
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
          installHook();
        },

        async unregister(name) {
          providers.delete(name);
          if (providers.size === 0) {
            uninstallHook();
          }
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
            searchEventFire = fire;
            return function () {
              searchEventFire = null;
            };
          },
        }).api(),
      },
    };
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) return;
    try {
      const { GlodaMsgSearcher } = ChromeUtils.importESModule(
        "resource:///modules/gloda/GlodaMsgSearcher.sys.mjs"
      );
      if (GlodaMsgSearcher && GlodaMsgSearcher.prototype.getCollection) {
        GlodaMsgSearcher.prototype.getCollection = originalGetCollection;
      }
    } catch (e) {}
  }
};
