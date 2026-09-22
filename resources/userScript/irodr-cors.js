// ==UserScript==
// @name        irodr: Replace fetch with gm_xmlhttprequest
// @namespace   https://irodr.netlify.app/
// @match       https://irodr.netlify.app/
// @grant       GM_xmlhttpRequest
// @version     2.1
// @author      azu
// @description Direct API Request without CORS Error
// @run-at document-start
// ==/UserScript==
// Disable CORS Proxy
localStorage.setItem("REACT_APP_CORS_PROXY", "");
// If you uninstall this script, you need to clear localStorage
// OR localStorage.removeItem("REACT_APP_CORS_PROXY")
// =====================
// override fetch with GM_xmlhttpRequest
// GM_xmlhttpRequest can ignore CORS
// These statuses must not carry a body. GitHub answers 205 to a repository
// mark-read; `new Response(blob, { status: 205 })` throws for them.
const NULL_BODY_STATUS = [204, 205, 304];
const fromEntries = (e) => e.reduce((acc, [k, v]) => ((acc[k] = v), acc), {});
// Header values contain ":" themselves (Date, Link, ...). Split on the first one only,
// otherwise a paginated `Link: <https://api.github.com/...>; rel="next"` is truncated.
// A status line or an unparsable header is skipped instead of failing the whole response.
const parseHeader = (h) => {
    const headers = new Headers();
    for (const line of String(h || "").split("\n")) {
        const separator = line.indexOf(":");
        if (separator === -1) {
            continue;
        }
        try {
            headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
        } catch (_) {
            // Keep the response usable even when a header name is invalid.
        }
    }
    return headers;
};
unsafeWindow.fetch = (input, init = {}) => {
    return new Promise((resolve, reject) => {
        const signal = init.signal;
        const aborted = () => new DOMException("The operation was aborted.", "AbortError");
        if (signal && signal.aborted) {
            return reject(aborted());
        }
        const headers =
            init.headers instanceof Headers ? fromEntries(Array.from(init.headers.entries())) : init.headers || {};
        const options = Object.assign({}, init, {
            method: init.method || "GET",
            headers,
            data: init.body,
            url: String(input),
            responseType: "blob"
        });
        // The promise must settle even when Response construction fails. An unsettled
        // fetch hangs every caller awaiting it, with no error anywhere.
        const settle = (xhr) => {
            try {
                resolve(
                    new Response(NULL_BODY_STATUS.includes(xhr.status) ? null : xhr.response, {
                        status: xhr.status,
                        statusText: xhr.statusText,
                        headers: parseHeader(xhr.responseHeaders)
                    })
                );
            } catch (error) {
                reject(new TypeError("Failed to convert the GM response into a Response.", { cause: error }));
            }
        };
        const request = GM_xmlhttpRequest(
            Object.assign({}, options, {
                onload: settle,
                onerror: () => reject(new TypeError("Failed to fetch")),
                ontimeout: () => reject(new TypeError("Failed to fetch")),
                onabort: () => reject(aborted())
            })
        );
        if (signal) {
            signal.addEventListener("abort", () => {
                if (request && typeof request.abort === "function") {
                    request.abort();
                } else {
                    reject(aborted());
                }
            });
        }
    });
};
