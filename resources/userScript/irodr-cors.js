// ==UserScript==
// @name        irodr: Replace fetch with gm_xmlhttprequest
// @namespace   https://irodr.netlify.app/
// @match       https://irodr.netlify.app/
// @grant       GM_xmlhttpRequest
// @version     2.0
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
const fromEntries = (e) => e.reduce((acc, [k, v]) => ((acc[k] = v), acc), {});
const parseHeader = (h) =>
    fromEntries(
        h
            .split("\n")
            .filter(Boolean)
            .map((l) => l.split(":").map((tok) => tok.trim()))
    );
unsafeWindow.fetch = (input, init = {}) => {
    return new Promise((res) => {
        if (init.headers instanceof Headers) {
            init.headers = fromEntries(Array.from(init.headers.entries()));
        }
        init.data = init.body;
        init = Object.assign(
            {
                method: "GET",
                headers: {}
            },
            init,
            {
                url: input,
                responseType: "blob"
            }
        );
        GM_xmlhttpRequest(
            Object.assign({}, init, {
                onload: (xhr) => {
                    xhr.headers = parseHeader(xhr.responseHeaders);
                    res(new Response(xhr.response, Object.assign({}, init, xhr)));
                },
                onerror: (xhr) => {
                    console.log("err", xhr);
                    res(new Response(xhr.response, Object.assign({}, init, xhr)));
                }
            })
        );
    });
};
