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

/** Priority: browser Translator API, the older experimental API, then a user script translator. */
async function createTranslator(sourceLanguage: string, targetLanguage: string): Promise<TranslatorHandle> {
    const languages = { sourceLanguage, targetLanguage };
    if (typeof Translator !== "undefined" && Translator) {
        if ((await Translator.availability(languages)) !== "unavailable") {
            return fromInstance(await Translator.create(languages));
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
        "No translator available. Install the irodr-translate userscript or use a browser with Translation API support."
    );
}

function textNodes(element: Element): Text[] {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!(node instanceof Text) || !node.textContent?.trim()) continue;
        let parent = node.parentElement;
        while (parent && parent !== element && !SKIPPED.has(parent.tagName)) parent = parent.parentElement;
        if (parent && parent !== element) continue;
        nodes.push(node);
    }
    return nodes;
}

function bodyOf(itemId: string): Element | null {
    return itemElement(itemId)?.querySelector(`.${CLASS.itemBody}`) ?? null;
}

/** Shift+T translate mode: translates the focused article, and each article moved to while on. */
export class TranslateMode {
    #enabled = false;
    #abort?: AbortController;
    /** Shared while being created, so turning the mode off can destroy it once it exists. */
    #translator?: Promise<TranslatorHandle>;
    private readonly notify: (message: string) => void;

    constructor(notify: (message: string) => void) {
        this.notify = notify;
    }

    get enabled(): boolean {
        return this.#enabled;
    }

    off(): void {
        if (!this.#enabled) return;
        this.#enabled = false;
        this.#abort?.abort();
        this.#abort = undefined;
        const translator = this.#translator;
        this.#translator = undefined;
        void translator?.then((handle) => handle.destroy()).catch(() => undefined);
    }

    async #getTranslator(): Promise<TranslatorHandle> {
        const pending = (this.#translator ??= createTranslator("en", "ja"));
        try {
            return await pending;
        } catch (error) {
            // Try again for the next article, e.g. after a translator user script is installed.
            if (this.#translator === pending) this.#translator = undefined;
            throw error;
        }
    }

    async toggle(focusedItemId: string | undefined): Promise<void> {
        if (this.#enabled) {
            this.off();
            for (const span of document.querySelectorAll(`[${ORIGINAL}]`)) {
                span.replaceWith(document.createTextNode(span.getAttribute(ORIGINAL) ?? ""));
            }
            this.notify("Translate mode: OFF");
            return;
        }
        this.#enabled = true;
        this.notify("Translate mode: ON");
        if (focusedItemId) await this.translate(focusedItemId);
    }

    async translate(itemId: string): Promise<void> {
        const body = bodyOf(itemId);
        if (!body || body.querySelector(`[${ORIGINAL}]`)) return;
        this.#abort?.abort();
        const abort = new AbortController();
        this.#abort = abort;
        try {
            const translator = await this.#getTranslator();
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
            if (!abort.signal.aborted) this.notify(error instanceof Error ? error.message : "Translation failed");
        } finally {
            if (this.#abort === abort) this.#abort = undefined;
        }
    }
}
