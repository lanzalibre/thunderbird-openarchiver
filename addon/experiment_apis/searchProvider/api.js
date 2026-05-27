"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { NetUtil } = ChromeUtils.importESModule(
  "resource://gre/modules/NetUtil.sys.mjs"
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

        function writeAndOpen(buf) {
          try {
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
            stream.init(tmpFile, 0x02 | 0x08 | 0x20, 0o666, 0);
            var bytes = new Uint8Array(buf);
            Services.console.logStringMessage(
              "searchProviders: writing " + bytes.length + " bytes to " + tmpFile.path
            );
            stream.write(bytes, bytes.length);
            stream.close();
            Services.console.logStringMessage(
              "searchProviders: file written, size=" + tmpFile.fileSize + " exists=" + tmpFile.exists()
            );
            var win = Services.wm.getMostRecentWindow(
              "mail:3pane"
            );
            if (win) {
              (async () => {
                try {
                  // Convert buf to string for MIME parsing
                  var rawEmail = "";
                  var rawBytes = new Uint8Array(buf);
                  for (var i = 0; i < rawBytes.length; i++) {
                    rawEmail += String.fromCharCode(rawBytes[i]);
                  }
                  // Parse email with MimeParser
                  var MimeParser = ChromeUtils.importESModule("resource:///modules/mimeParser.sys.mjs").MimeParser;
                  var hdrs = MimeParser.extractHeaders(rawEmail);
                  function getHdr(name) { return String(hdrs.has(name) ? hdrs.get(name) : ""); }
                  var subject = getHdr("subject") || "(no subject)";
                  var from = getHdr("from");
                  var to = getHdr("to");
                  var date = getHdr("date");
                  // Fall back to raw regex if MimeParser returns objects
                  if (from == "[object Object]" || from == "") {
                    var m = rawEmail.match(/^From:\s*(.*)$/im);
                    from = m ? m[1].trim() : "";
                  }
                  if (to == "[object Object]" || to == "") {
                    var m = rawEmail.match(/^To:\s*(.*)$/im);
                    to = m ? m[1].trim() : "";
                  }
                  if (date == "[object Object]" || date == "") {
                    var m = rawEmail.match(/^Date:\s*(.*)$/im);
                    date = m ? m[1].trim() : "";
                  }
                  if (subject == "[object Object]" || subject == "(no subject)") {
                    var m = rawEmail.match(/^Subject:\s*(.*)$/im);
                    subject = m ? m[1].trim() : "(no subject)";
                  }
                  // Normalize line endings
                  var nl = rawEmail.replace(/\r\n/g, '\n');
                  // UTF-8 decoder (TextDecoder not available in experiment sandbox)
                  function utf8Decode(b) {
                    var r = "";
                    for (var i = 0; i < b.length; i++) {
                      var v = b[i];
                      if (v < 0x80) { r += String.fromCharCode(v); }
                      else if (v >= 0xC0 && v < 0xE0) { r += String.fromCharCode(((v & 0x1F) << 6) | (b[++i] & 0x3F)); }
                      else if (v >= 0xE0 && v < 0xF0) { r += String.fromCharCode(((v & 0x0F) << 12) | ((b[++i] & 0x3F) << 6) | (b[++i] & 0x3F)); }
                      else if (v >= 0xF0 && v < 0xF8) { var c = ((v & 0x07) << 18) | ((b[++i] & 0x3F) << 12) | ((b[++i] & 0x3F) << 6) | (b[++i] & 0x3F); c -= 0x10000; r += String.fromCharCode(0xD800 + (c >> 10), 0xDC00 + (c & 0x3FF)); }
                    }
                    return r;
                  }
                  // QP decoder: bytes then UTF-8
                  function qpDecode(s) {
                    var b = [];
                    for (var i = 0; i < s.length; i++) {
                      if (s[i] == '=' && i + 2 < s.length && /[0-9A-Fa-f]{2}/i.test(s.substring(i+1, i+3))) {
                        b.push(parseInt(s.substring(i+1, i+3), 16));
                        i += 2;
                      } else if (s[i] == '=' && s[i+1] == '\n') { i++; }
                      else { b.push(s.charCodeAt(i)); }
                    }
                    return utf8Decode(b);
                  }
                  // Base64 decoder: bytes then UTF-8
                  function b64Decode(s) {
                    var c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
                    var b = [];
                    s = s.replace(/[^A-Za-z0-9+/=]/g, '');
                    for (var i = 0; i < s.length; i += 4) {
                      if (i + 3 >= s.length) break;
                      var a = c.indexOf(s[i]), d = c.indexOf(s[i+1]), e = c.indexOf(s[i+2]), f = c.indexOf(s[i+3]);
                      if (a==-1||d==-1) break;
                      b.push((a << 2) | (d >> 4));
                      if (e != -1) b.push(((d & 15) << 4) | (e >> 2));
                      if (f != -1) b.push(((e & 3) << 6) | f);
                    }
                    return utf8Decode(b);
                  }
                  function getHdrVal(hdrs, name) {
                    var re = new RegExp("^" + name + ":\\s*([\\s\\S]*?)(?:\\n[^\\s]|$)", "im");
                    var m = hdrs.match(re);
                    return m ? m[1].replace(/\n\s+/g, '').trim() : "";
                  }
                  function getEnc(hdrs) { return getHdrVal(hdrs, "Content-Transfer-Encoding").toLowerCase(); }
                  function decodeBody(b, enc) {
                    if (enc == "base64") return b64Decode(b);
                    if (enc == "quoted-printable") return qpDecode(b);
                    return b;
                  }
                  // Extract body with proper MIME handling
                  var bodyHtml = "";
                  try {
                    // Find Content-Type in outer headers only (before first MIME boundary)
                    var outerEnd = nl.indexOf("\n\n--");
                    var searchSpace = outerEnd >= 0 ? nl.substring(0, outerEnd) : nl;
                    var ctIdx = searchSpace.lastIndexOf("Content-Type:");
                    var hdrText, rawBody;
                    if (ctIdx >= 0) {
                      var afterCt = nl.substring(ctIdx);
                      var blIdx = afterCt.indexOf("\n\n");
                      if (blIdx >= 0) {
                        hdrText = nl.substring(0, ctIdx + blIdx);
                        rawBody = nl.substring(ctIdx + blIdx + 2);
                      } else { hdrText = nl; rawBody = ""; }
                    } else {
                      var sp = nl.indexOf("\n\n");
                      hdrText = sp >= 0 ? nl.substring(0, sp) : nl;
                      rawBody = sp >= 0 ? nl.substring(sp + 2) : "";
                    }
                    var ct = getHdrVal(hdrText, "Content-Type");
                    var boundary = ct.match(/boundary\s*=\s*"?([^";\s]+)"?/i);
                    if (boundary && ct.includes("multipart/")) {
                      var parts = rawBody.split("--" + boundary[1]);
                      for (var p = 0; p < parts.length; p++) {
                        var part = parts[p];
                        if (part == "" || part.startsWith("--")) continue;
                        var pIdx = part.indexOf("\n\n");
                        if (pIdx >= 0) {
                          var ph = part.substring(0, pIdx);
                          var pb = part.substring(pIdx + 2);
                          var pct = getHdrVal(ph, "Content-Type");
                          if (pct.includes("text/html") && !bodyHtml) {
                            bodyHtml = decodeBody(pb, getEnc(ph));
                          } else if (pct.includes("text/plain") && !bodyHtml) {
                            bodyHtml = "<pre>" + decodeBody(pb, getEnc(ph)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + "</pre>";
                          }
                        }
                      }
                    }
                    if (!bodyHtml) {
                      bodyHtml = decodeBody(rawBody, getEnc(hdrText));
                      if (!ct.includes("text/html")) {
                        bodyHtml = "<pre>" + bodyHtml.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + "</pre>";
                      }
                    }
                  } catch (e) {
                    Services.console.logStringMessage("searchProviders: body extraction error: " + e.message);
                  }
                  if (!bodyHtml) { bodyHtml = "<pre>" + rawEmail.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + "</pre>"; }
                  // Build viewer HTML
                  var shortSubj = subject.length > 60 ? subject.substring(0, 57) + "..." : subject;
                  var viewer = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + shortSubj.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</title><style>'
                    + 'body{margin:0;font-family:system-ui,sans-serif;color:#222}'
                    + '.hdr{background:#f5f5f5;padding:10px 16px;border-bottom:1px solid #ddd;font-size:13px}'
                    + '.hdr .r{margin:3px 0}.hdr .l{display:inline-block;width:60px;font-weight:600;color:#666}'
                    + '.hdr .s{font-size:15px;font-weight:600;color:#000}'
                    + '.body{padding:16px}</style></head><body>'
                    + '<div class="hdr">'
                    + '<div class="r s">' + subject.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</div>'
                    + '<div class="r"><span class="l">From:</span>' + from.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</div>'
                    + '<div class="r"><span class="l">To:</span>' + to.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</div>'
                    + '<div class="r"><span class="l">Date:</span>' + date.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</div>'
                    + '</div><div class="body">' + bodyHtml + '</div></body></html>';
                  var dataUri = "data:text/html," + encodeURIComponent(viewer);
                  var tabmail = win.document.getElementById("tabmail");
                  if (tabmail) {
                    var tab = tabmail.openTab("contentTab", { url: dataUri });
                    if (tab && tab.title !== undefined) { tab.title = shortSubj; }
                    Services.console.logStringMessage("searchProviders: opened email viewer");
                  }
                } catch (e) {
                  Services.console.logStringMessage("searchProviders: import error: " + (e.message || e) + " stack=" + (e.stack || ""));
                }
              })();
            }
          } catch (e) {
            Services.console.logStringMessage(
              "searchProviders: writeAndOpen error: " +
                (e.message || e)
            );
          }
        }

        function openInBrowser(resultUrl) {
          try {
            var ep = Cc[
              "@mozilla.org/uriloader/external-protocol-service;1"
            ].getService(Ci.nsIExternalProtocolService);
            ep.loadURI(
              Services.io.newURI(resultUrl, null, null)
            );
          } catch (e) {
            Services.console.logStringMessage(
              "searchProviders: openUrl error: " +
                (e.message || e)
            );
          }
        }

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

          (function (url_0, spath, apibase, apikey) {
            item.addEventListener("click", function () {
              function downloadAndOpen() {
                try {
                  var downloadUrl =
                    apibase.replace(/\/+$/, "") +
                    "/v1/storage/download?path=" +
                    encodeURIComponent(spath);
                  var uri = Services.io.newURI(downloadUrl);
                  var channel = Services.io.newChannelFromURI(
                    uri,
                    null,
                    Services.scriptSecurityManager
                      .getSystemPrincipal(),
                    null,
                    Ci.nsILoadInfo
                      .SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
                    Ci.nsIContentPolicy.TYPE_OTHER
                  );
                  var httpChannel = channel.QueryInterface(
                    Ci.nsIHttpChannel
                  );
                  if (apikey) {
                    httpChannel.setRequestHeader(
                      "X-API-Key",
                      apikey,
                      false
                    );
                  }
                  NetUtil.asyncFetch(
                    channel,
                    function (inputStream, status) {
                      try {
                        if (!Components.isSuccessCode(status)) {
                          throw new Error(
                            "Request failed with status " +
                              status
                          );
                        }
                        var bis = Cc[
                          "@mozilla.org/binaryinputstream;1"
                        ].createInstance(
                          Ci.nsIBinaryInputStream
                        );
                        bis.setInputStream(inputStream);
                        var available = bis.available();
                        if (available === 0) {
                          throw new Error(
                            "Empty response (0 bytes)"
                          );
                        }
                        var bytes =
                          bis.readByteArray(available);
                        bis.close();
                        writeAndOpen(bytes);
                      } catch (e) {
                        Services.console.logStringMessage(
                          "searchProviders: downloadEml error: " +
                            (e.message || e)
                        );
                        if (url_0) openInBrowser(url_0);
                      }
                    }
                  );
                } catch (e) {
                  Services.console.logStringMessage(
                    "searchProviders: downloadEml setup error: " +
                      (e.message || e)
                  );
                  if (url_0) openInBrowser(url_0);
                }
              }

              if (spath && apibase) {
                downloadAndOpen();
              } else if (url_0) {
                openInBrowser(url_0);
              }
            });
          })(result.url, result.storagePath, result.apiBaseUrl, result.apiKey);

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
