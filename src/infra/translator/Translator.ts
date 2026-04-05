/// <reference path="../../types/translation.d.ts" />

export type TranslateBatchFn = (texts: string[]) => Promise<string[]>;

export type TranslatorHandle = {
    translateBatch: TranslateBatchFn;
    destroy: () => void;
};

/**
 * UserScript-provided translator interface.
 * Greasemonkey scripts can set `window.irodrTranslator` to provide translation
 * via GM_xmlhttpRequest (bypassing CORS restrictions).
 */
export type IrodrTranslator = {
    translateBatch(texts: string[], sourceLanguage: string, targetLanguage: string): Promise<string[]>;
};

declare global {
    interface Window {
        irodrTranslator?: IrodrTranslator;
    }
}

/**
 * Priority: Browser Translation API > UserScript translator (window.irodrTranslator)
 * Call `destroy()` when done to release resources.
 */
export async function createTranslator(sourceLanguage: string, targetLanguage: string): Promise<TranslatorHandle> {
    // 1. Browser Translation API (Chrome 131+)
    if (window.translation) {
        const availability = await window.translation.canTranslate({ sourceLanguage, targetLanguage });
        if (availability !== "no") {
            const translator = await window.translation.createTranslator({ sourceLanguage, targetLanguage });
            return {
                translateBatch: async (texts: string[]) => {
                    const results: string[] = [];
                    for (const text of texts) {
                        results.push(await translator.translate(text));
                    }
                    return results;
                },
                destroy: () => translator.destroy()
            };
        }
    }
    // 2. UserScript-provided translator (e.g. Greasemonkey with GM_xmlhttpRequest)
    if (window.irodrTranslator) {
        const userScriptTranslator = window.irodrTranslator;
        return {
            translateBatch: (texts: string[]) =>
                userScriptTranslator.translateBatch(texts, sourceLanguage, targetLanguage),
            destroy: () => {}
        };
    }
    throw new Error(
        "No translator available. Install the irodr-translate userscript or use a browser with Translation API support."
    );
}

const DATA_ORIGINAL_TEXT = "data-original-text";

export function isTranslated(element: Element): boolean {
    return element.querySelector(`[${DATA_ORIGINAL_TEXT}]`) !== null;
}

export function restoreElement(element: Element): void {
    const spans = Array.from(element.querySelectorAll(`[${DATA_ORIGINAL_TEXT}]`));
    for (const span of spans) {
        const original = span.getAttribute(DATA_ORIGINAL_TEXT);
        if (original !== null) {
            span.replaceWith(document.createTextNode(original));
        }
    }
}

const SKIP_TAGS = new Set(["PRE", "CODE", "KBD", "SAMP", "VAR"]);

function isInsideSkippedTag(node: Node): boolean {
    let parent = node.parentElement;
    while (parent) {
        if (SKIP_TAGS.has(parent.tagName)) return true;
        parent = parent.parentElement;
    }
    return false;
}

function collectTextNodes(element: Element): Text[] {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
        if (node.textContent && node.textContent.trim().length > 0 && !isInsideSkippedTag(node)) {
            textNodes.push(node);
        }
    }
    return textNodes;
}

function replaceWithTranslated(textNodes: Text[], originals: string[], translated: string[]): void {
    for (let i = 0; i < textNodes.length; i++) {
        const span = document.createElement("span");
        span.setAttribute(DATA_ORIGINAL_TEXT, originals[i]);
        span.textContent = translated[i];
        textNodes[i].replaceWith(span);
    }
}

export async function translateElement(
    element: Element,
    translateBatchFn: TranslateBatchFn,
    signal?: AbortSignal
): Promise<void> {
    const textNodes = collectTextNodes(element);
    if (textNodes.length === 0) return;
    const originals = textNodes.map((n) => n.textContent ?? "");
    if (signal?.aborted) return;
    const translated = await translateBatchFn(originals);
    if (signal?.aborted) return;
    replaceWithTranslated(textNodes, originals, translated);
}
