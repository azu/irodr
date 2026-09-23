import { CLASS, itemElement } from "./dom.ts";

type TranslateBatch = (texts: string[]) => Promise<string[]>;

interface TranslatorHandle {
    translateBatch: TranslateBatch;
    destroy: () => void;
}

const ORIGINAL = "data-original-text";
const SKIPPED = new Set(["PRE", "CODE", "KBD", "SAMP", "VAR"]);

function fromInstance(instance: { translate(text: string): Promise<string>; destroy(): void }): TranslatorHandle {
    return {
        translateBatch: async (texts: string[]) => {
            const results: string[] = [];
            for (const text of texts) results.push(await instance.translate(text));
            return results;
        },
        destroy: () => instance.destroy()
    };
}

/** The browser's Translator API. It is not Baseline: it is feature-detected, and translation is optional. */
function builtInTranslator(): typeof Translator | undefined {
    // oxlint-disable-next-line baseline-js/use-baseline
    return typeof Translator === "undefined" ? undefined : Translator;
}

/** Priority: browser Translator API, the older experimental API, then a user script translator. */
async function createTranslator(sourceLanguage: string, targetLanguage: string): Promise<TranslatorHandle> {
    const languages = { sourceLanguage, targetLanguage };
    const browserTranslator = builtInTranslator();
    if (browserTranslator) {
        if ((await browserTranslator.availability(languages)) !== "unavailable") {
            return fromInstance(await browserTranslator.create(languages));
        }
    }
    if (window.translation && (await window.translation.canTranslate(languages)) !== "no") {
        return fromInstance(await window.translation.createTranslator(languages));
    }
    const userScript = window.irodrTranslator;
    if (userScript) {
        return {
            translateBatch: (texts) => userScript.translateBatch(texts, sourceLanguage, targetLanguage),
            destroy: () => undefined
        };
    }
    throw new Error(
        "No translator available. Install irodr-translate.user.js or use a browser with Translator API support."
    );
}

/** Whether `node` is inside a skipped element (code, ...) below `root`. */
function insideSkipped(node: Node, root: Element): boolean {
    const parent = node.parentElement;
    if (!parent || parent === root) return false;
    return SKIPPED.has(parent.tagName) || insideSkipped(parent, root);
}

function textNodes(element: Element): Text[] {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!(node instanceof Text) || !node.textContent?.trim()) continue;
        if (insideSkipped(node, element)) continue;
        nodes.push(node);
    }
    return nodes;
}

function bodyOf(itemId: string): Element | null {
    return itemElement(itemId)?.querySelector(`.${CLASS.itemBody}`) ?? null;
}

/** Shift+T translate mode: translates the focused article, and each article moved to while on. */
export interface TranslateMode {
    enabled: () => boolean;
    off: () => void;
    toggle: (focusedItemId: string | undefined) => Promise<void>;
    translate: (itemId: string) => Promise<void>;
}

export function createTranslateMode(notify: (message: string) => void): TranslateMode {
    const mode: {
        enabled: boolean;
        abort: AbortController | undefined;
        /** Shared while being created, so turning the mode off can destroy it once it exists. */
        translator: Promise<TranslatorHandle> | undefined;
    } = { enabled: false, abort: undefined, translator: undefined };

    const off = (): void => {
        if (!mode.enabled) return;
        mode.enabled = false;
        mode.abort?.abort();
        mode.abort = undefined;
        const translator = mode.translator;
        mode.translator = undefined;
        void translator?.then((handle) => handle.destroy()).catch(() => undefined);
    };

    const getTranslator = async (): Promise<TranslatorHandle> => {
        const pending = (mode.translator ??= createTranslator("en", "ja"));
        try {
            return await pending;
        } catch (error) {
            // Try again for the next article, e.g. after a translator user script is installed.
            if (mode.translator === pending) mode.translator = undefined;
            throw error;
        }
    };

    const translate = async (itemId: string): Promise<void> => {
        const body = bodyOf(itemId);
        if (!body || body.querySelector(`[${ORIGINAL}]`)) return;
        mode.abort?.abort();
        const abort = new AbortController();
        mode.abort = abort;
        try {
            const translator = await getTranslator();
            const nodes = textNodes(body);
            if (nodes.length === 0 || abort.signal.aborted) return;
            const originals = nodes.map((node) => node.textContent ?? "");
            const translated = await translator.translateBatch(originals);
            if (abort.signal.aborted) return;
            nodes.forEach((node, index) => {
                const span = document.createElement("span");
                span.setAttribute(ORIGINAL, originals[index] ?? "");
                span.textContent = translated[index] ?? "";
                node.replaceWith(span);
            });
        } catch (error) {
            if (!abort.signal.aborted) notify(error instanceof Error ? error.message : "Translation failed");
        } finally {
            if (mode.abort === abort) mode.abort = undefined;
        }
    };

    const toggle = async (focusedItemId: string | undefined): Promise<void> => {
        if (mode.enabled) {
            off();
            for (const span of document.querySelectorAll(`[${ORIGINAL}]`)) {
                span.replaceWith(document.createTextNode(span.getAttribute(ORIGINAL) ?? ""));
            }
            notify("Translate mode: OFF");
            return;
        }
        mode.enabled = true;
        notify("Translate mode: ON");
        if (focusedItemId) await translate(focusedItemId);
    };

    return { enabled: () => mode.enabled, off, toggle, translate };
}
