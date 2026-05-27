# Approaches Tested — Email Display in Thunderbird

All approaches tested to display downloaded .eml files inside Thunderbird when the user clicks an OA search result.

## All Approaches Tested

### 1. `MailUtils.openEMLFile` — FAILS
- Code: `MailUtils.openEMLFile(win, tmpFile, fileUri)`
- Result: Tab opens but blank. No errors.
- Analysis: Calls `tabmail.openTab("mailMessageTab", { messageURI: url.spec })` internally.
- Verdict: **Blank tab — root cause unclear.**

### 2. `mailMessageTab` directly — FAILS
- Code: `tabmail.openTab("mailMessageTab", { messageURI: fileUri.spec + "?type=application/x-message-display" })`
- Result: Tab opens but blank.
- Analysis: `mailMessageTab.openTab()` calls `win.displayMessage(messageURI)` from `aboutMessage.js`. `displayMessage` calls `MailServices.messageServiceFromURI(uri)` which maps `file://` → `mailbox://` service, then `messageURIToMsgHdr(fileUri)` — mailbox service can't parse `file://` URIs → fails silently.
- Verdict: **Blank tab — message service mapping breaks file:// URI handling.**

### 3. `contentTab` with file:// URL — FAILS
- Code: `tabmail.openTab("contentTab", { url: fileUri.spec })`
- Result: Blank tab.
- Analysis: TB 151 blocks `file://` URL loading in content browser (security sandbox).
- Verdict: **Security restriction.**

### 4. `contentTab` with `contentPage` — FAILS
- Code: `tabmail.openTab("contentTab", { contentPage: fileUri.spec })`
- Result: `Error: url must be specified`
- Analysis: `contentTab` expects `url` param, not `contentPage`.
- Verdict: **Wrong API — fixed in approach 3/5.**

### 5. `openDialog` + `messageWindow.xhtml` — FAILS
- Code: `win.openDialog("chrome://messenger/content/messageWindow.xhtml", "", "all,chrome,dialog=no", msgUri)` where `msgUri` is a string
- Result: No error, window opens but blank.
- Analysis: `messageWindow.xhtml`'s `onLoad` checks `window.arguments[0] instanceof Ci.nsIURI`. Passing a string misses this branch → falls through to wrong handler.
- Verdict: **Wrong argument type — must pass `nsIURI`, not string.**

### 6. `nsIWindowWatcher.openWindow` + `messageWindow.xhtml` — FAILS
- Code: `ww.openWindow(win, "chrome://messenger/content/messageWindow.xhtml", "_blank", "all,chrome,dialog=no", msgUri)` where `msgUri` is `nsIURI`
- Result: Window opens but blank.
- Analysis: Same root cause as approach 2 — `displayMessage()` uses mailbox service which can't handle `file://` URIs.
- Verdict: **Same as approach 2 — message service mapping breaks file:// URI handling.**

### 7. `copyFileMessage` import to Local Folders — FAILS
- Code: `MailServices.copy.copyFileMessage(destFile, tempFolder, ...)` via `MailUtils.copyFileMessageAsync`
- Result: `NS_ERROR_FILE_IS_DIRECTORY [nsIMsgCopyService.copyFileMessage]`
- Analysis: `copyFileMessage` rejects source files it can't parse as valid messages. Even though destFile is a valid .eml on disk, the copy service treats it as a directory (confusing error code).
- Verdict: **Service rejects .eml file parsing.**

### 8. `data:` URI in contentTab — WORKS
- Code: `tabmail.openTab("contentTab", { url: "data:text/plain;base64,..." })`
- Result: Raw email text displays in contentTab.
- Analysis: `data:` URIs work in contentTab (no file:// restriction). First confirmation that data URI approach is viable.
- Verdict: **Proves content valid. Foundation for email viewer.**

### 9. MimeParser body extraction — FAILS
- Code: `MimeParser.parseSync(rawEmail, emitter, { bodyformat: "decode" })` with custom emitter `startPart`/`deliverPartData`
- Result: `bodyHtml` always empty → fallback shows raw email in `<pre>`.
- Analysis: Two issues:
  - `bodyformat: "none"` (default) suppresses body data entirely — fixed by switching to `"decode"`.
  - `partHeaders.get("content-type")` returns a structured object (e.g. `{value: "text/html", ...}`), not a string. `.includes("text/html")` on the object returns false because the object is coerced to `"[object Object]"`. Various `getType()` normalization helpers were tried but failed — suggests the header value format differs from expected.
- Verdict: **MimeParser content-type detection is unreliable for body extraction in this sandbox.**

### 10. Manual body extraction (blank-line split) — CURRENT APPROACH
- Code: Find first `\n\n` or `\r\n\r\n` in raw email; take everything after as body.
- Result: Pending user test.
- Analysis: Works for simple single-part HTML/plain emails. Handles most OA archive emails (which are plain or 7bit HTML). Does NOT handle:
  - Content-Transfer-Encoding: base64 or quoted-printable (body will show as encoded)
  - Multipart MIME boundaries (body will include boundaries and parts)
- Verdict: **Simple and reliable for common case. Iterate on encoding/ multipart as needed.**

### 11. Manual MIME parser (boundary split + QP/b64 decode + UTF-8) — CURRENT APPROACH
- Code: Normalize `\r\n`→`\n`, find last `Content-Type` in outer headers (before first `\n\n--`), parse multipart boundaries, decode QP/base64 per part, decode bytes as UTF-8 via manual `utf8Decode()`, prefer HTML over plain text.
- Result: Pending user test.
- Analysis: Handles Gmail export format (duplicated headers with OA metadata prefix), multipart/alternative, quoted-printable encoding, base64 encoding, UTF-8 multi-byte decoding. Does NOT handle:
  - Non-UTF-8 charsets (e.g. ISO-8859-1, Windows-1252)
  - Nested multipart (e.g. multipart/mixed containing multipart/alternative)
  - `Content-Type:` literal text in email body (false positive on lastIndexOf)
- Verdict: **Handles most OA archive emails. Iterate on charsets and nesting as needed.**

### 12. UTF-8 decode: `TextDecoder` → FAILS, manual `utf8Decode` → WORKS
- Code: `new TextDecoder().decode(new Uint8Array(b))` → `TextDecoder is not defined` in experiment sandbox
- Fix: Manual UTF-8 decoder handling 1-4 byte sequences + surrogate pairs for chars > U+FFFF
- Result: Works correctly for all UTF-8 encoded email bodies.

## Key Technical Findings

### `MailServices.messageServiceFromURI()` mapping
- In `MailServices.sys.mjs`:
  ```javascript
  if (protocol == "file") { protocol = "mailbox"; }
  ```
- All `file://` URIs are routed to the `mailbox://` message service, which can't parse `file://` URIs.
- This breaks `messageURIToMsgHdr()` and `loadMessage()` for file-based messages.

### Available HTTP API in experiment sandbox
- `fetch()` — NOT available
- `XMLHttpRequest` — NOT available
- `btoa()` — NOT available
- `TextDecoder` — NOT available
- `nsIHttpChannel` via `NetUtil.asyncFetch` — WORKS

### TB 151 Security Restrictions
- `file://` URLs blocked in content browser
- `data:` URIs should work in `contentTab`
- `mailMessageTab` requires valid `mailbox://` URIs

### Quoted-Printable + UTF-8 Decoding
- QP decoder must decode to raw bytes, then decode bytes as UTF-8 via `TextDecoder`
- `String.fromCharCode(byte)` treats bytes as Latin-1 — breaks multi-byte UTF-8 chars (é → Ã©)
- Same for base64: decode to bytes first, then UTF-8 decode
- `TextDecoder` is NOT available in experiment sandbox — use manual `utf8Decode()` instead

### Gmail Export Format
- OA archive emails from Gmail export have duplicated headers:
  - Brief metadata headers (Subject, From, To, Date)
  - Blank line
  - Full RFC822 email (with X-GM-THRID, full headers, Content-Type)
- Must find `Content-Type` in outer headers only (before first `\n\n--` MIME boundary)
- `getHdrVal()` regex handles header continuation lines: `Content-Type: multipart/alternative;\n\tboundary=xxx`
