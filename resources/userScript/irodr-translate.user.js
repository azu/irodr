// ==UserScript==
// @name        irodr: Google Translate
// @namespace   https://irodr.netlify.app/
// @match       https://irodr.netlify.app/
// @match       http://localhost:*/*
// @grant       GM_xmlhttpRequest
// @connect     translate-pa.googleapis.com
// @version     1.0
// @author      azu
// @description Provides Google Translate for irodr via GM_xmlhttpRequest (bypasses CORS)
// @run-at      document-start
// ==/UserScript==

// Public API key embedded in Google's translate JS (same as Traduzir-paginas-web)
const GOOGLE_TRANSLATE_API_KEY = "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520";

function stripHtmlTags(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || html;
}

/**
 * @param {string[]} texts
 * @param {string} sourceLanguage
 * @param {string} targetLanguage
 * @returns {Promise<string[]>}
 */
function translateBatch(texts, sourceLanguage, targetLanguage) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify([[texts, sourceLanguage, targetLanguage], "te"]);
        GM_xmlhttpRequest({
            method: "POST",
            url: "https://translate-pa.googleapis.com/v1/translateHtml",
            headers: {
                "Content-Type": "application/json+protobuf",
                "X-goog-api-key": GOOGLE_TRANSLATE_API_KEY
            },
            data: body,
            responseType: "json",
            onload: function (response) {
                if (response.status !== 200) {
                    reject(new Error("Google Translate request failed: " + response.status));
                    return;
                }
                const data = response.response;
                const translatedArray = (data && data[0]) || [];
                resolve(
                    translatedArray.map(function (html) {
                        return stripHtmlTags(html);
                    })
                );
            },
            onerror: function (error) {
                reject(new Error("Google Translate network error"));
            }
        });
    });
}

// Expose translator API for irodr
unsafeWindow.irodrTranslator = {
    translateBatch: translateBatch
};
