// ==UserScript==
// @name        irodr: Translate with Google Translate
// @namespace   https://irodr.netlify.app/
// @match       https://irodr.netlify.app/*
// @match       http://localhost:8888/*
// @grant       GM_xmlhttpRequest
// @connect     translate.googleapis.com
// @version     1.0
// @author      azu
// @description Shift+T translates with Google Translate when the browser has no Translator API
// @run-at      document-start
// ==/UserScript==
//
// Irodr uses `window.irodrTranslator` when the browser's Translator API is unavailable (see docs/userscript.md).
// This script calls translate.googleapis.com/translate_a/single, the unofficial endpoint that browser extensions
// such as Traduzir-paginas-web and Simple Translate use. It is not a documented API: Google may rate-limit or
// change it at any time, and you use it at your own risk. GM_xmlhttpRequest is needed because the endpoint does
// not allow CORS requests from web pages.

// `gtx` has answered 429 since 2026-09 (https://github.com/eeeXun/gtt/issues/43). Change this if `at` stops working.
const CLIENT = "at";
const ENDPOINT = "https://translate.googleapis.com/translate_a/single";
// Characters per request. Google Translate answers long texts, but smaller requests fail less often.
const MAX_CHARS = 4000;

const post = (sourceLanguage, targetLanguage, text) =>
    new Promise((resolve, reject) => {
        const query = new URLSearchParams({ client: CLIENT, sl: sourceLanguage, tl: targetLanguage, dt: "t" });
        GM_xmlhttpRequest({
            method: "POST",
            url: `${ENDPOINT}?${query}`,
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            data: new URLSearchParams({ q: text }).toString(),
            responseType: "json",
            onload: (response) => {
                if (response.status !== 200) {
                    reject(new Error(`Google Translate failed: HTTP ${response.status}`));
                    return;
                }
                const data = typeof response.response === "string" ? JSON.parse(response.response) : response.response;
                // [[["translated", "original", ...], ...], null, "en", ...]
                resolve((data?.[0] ?? []).map((segment) => segment?.[0] ?? "").join(""));
            },
            onerror: () => reject(new Error("Google Translate failed: network error")),
            ontimeout: () => reject(new Error("Google Translate failed: timeout"))
        });
    });

// A text node's surrounding spaces separate it from its neighbors; Google Translate drops them.
const keepSpaces = (original, translated) => {
    const leading = /^\s*/.exec(original)[0];
    const trailing = /\s*$/.exec(original)[0];
    return leading + translated.trim() + trailing;
};

// Groups texts into requests of at most MAX_CHARS. A text longer than that is a request of its own.
const chunk = (texts) =>
    texts.reduce((chunks, text) => {
        const last = chunks[chunks.length - 1];
        const size = last ? last.reduce((sum, item) => sum + item.length + 1, 0) : Infinity;
        return last && size + text.length <= MAX_CHARS
            ? [...chunks.slice(0, -1), [...last, text]]
            : [...chunks, [text]];
    }, []);

// One request per chunk: the texts are joined with newlines and Google Translate keeps one line per line.
// When the line count differs, the chunk is translated again one text at a time.
const translateChunk = async (texts, sourceLanguage, targetLanguage) => {
    const lines = texts.map((text) => text.replace(/\s+/g, " ").trim());
    const translated = (await post(sourceLanguage, targetLanguage, lines.join("\n"))).split("\n");
    if (translated.length === texts.length) return translated;
    const results = [];
    for (const line of lines) results.push(await post(sourceLanguage, targetLanguage, line));
    return results;
};

unsafeWindow.irodrTranslator = {
    async translateBatch(texts, sourceLanguage, targetLanguage) {
        const results = [];
        for (const group of chunk(texts)) {
            results.push(...(await translateChunk(group, sourceLanguage, targetLanguage)));
        }
        return results.map((translated, index) => keepSpaces(texts[index], translated));
    }
};
