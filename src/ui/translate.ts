import type { LocalApi } from "../lib/local-api.ts";
import type { TranslationStreamOptions } from "../lib/translation-stream.ts";
import { articleScroller, CLASS, itemElement } from "./dom.ts";
import { applyVisibleTexts, nextTranslationBatch, restoreOriginals } from "./translate-dom.ts";

interface TranslatorHandle {
    translate: (texts: string[], options: TranslationStreamOptions) => Promise<void>;
    batchCharacters: number;
    destroy: () => void;
}

/** Streaming removes the all-results barrier. Legacy backends need smaller batches for an early first result. */
const STREAM_CHARACTERS = 1000;
const LEGACY_CHARACTERS = 300;

function fromBatch(translate: (texts: string[]) => Promise<string[]>): TranslatorHandle {
    return {
        batchCharacters: LEGACY_CHARACTERS,
        translate: async (texts, { onResult, signal }) => {
            signal?.throwIfAborted();
            const translated = await translate(texts);
            signal?.throwIfAborted();
            texts.forEach((source, index) => onResult({ index, text: translated[index] ?? source }));
        },
        destroy: () => undefined
    };
}

function fromInstance(instance: { translate(text: string): Promise<string>; destroy(): void }): TranslatorHandle {
    return {
        batchCharacters: STREAM_CHARACTERS,
        translate: async (texts, { onResult, signal }) => {
            for (const [index, source] of texts.entries()) {
                signal?.throwIfAborted();
                const text = await instance.translate(source);
                signal?.throwIfAborted();
                onResult({ index, text });
            }
        },
        destroy: () => instance.destroy()
    };
}

/** The browser's Translator API. It is not Baseline: it is feature-detected, and translation is optional. */
function builtInTranslator(): typeof Translator | undefined {
    // oxlint-disable-next-line baseline-js/use-baseline
    return typeof Translator === "undefined" ? undefined : Translator;
}

/**
 * Priority: the local server (irodr-local, e.g. Apple's Translation framework), the browser Translator API,
 * the older experimental API, then a user script translator.
 */
async function createTranslator(
    sourceLanguage: string,
    targetLanguage: string,
    local: LocalApi
): Promise<TranslatorHandle> {
    const languages = { sourceLanguage, targetLanguage };
    const localFeatures = (await local.info())?.features;
    if (localFeatures?.has("translate")) {
        if (!localFeatures.has("translate-stream"))
            return fromBatch((texts) => local.translate(texts, sourceLanguage, targetLanguage));
        return {
            batchCharacters: STREAM_CHARACTERS,
            translate: (texts, options) => local.translateStream(texts, sourceLanguage, targetLanguage, options),
            destroy: () => undefined
        };
    }
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
        return fromBatch((texts) => userScript.translateBatch(texts, sourceLanguage, targetLanguage));
    }
    throw new Error(
        "No translator available. Run irodr-local, install the irodr-translate userscript or use a browser with Translation API support."
    );
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

export function createTranslateMode(
    notify: (message: string, options?: { error?: boolean }) => void,
    local: LocalApi
): TranslateMode {
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
        const pending = (mode.translator ??= createTranslator("en", "ja", local));
        try {
            return await pending;
        } catch (error) {
            // Try again for the next article, e.g. after a translator user script is installed.
            if (mode.translator === pending) mode.translator = undefined;
            throw error;
        }
    };

    const translate = async (itemId: string): Promise<void> => {
        mode.abort?.abort();
        const abort = new AbortController();
        mode.abort = abort;
        try {
            // Reader state can change just before React mounts a newly loaded article.
            const body =
                bodyOf(itemId) ??
                (await new Promise<Element | null>((resolve) => {
                    requestAnimationFrame(() => resolve(bodyOf(itemId)));
                }));
            if (!body || abort.signal.aborted) return;
            const translator = await getTranslator();
            if (abort.signal.aborted) return;
            const work = { running: false, frame: 0 };
            const pump = async () => {
                if (work.running || abort.signal.aborted) return;
                work.running = true;
                try {
                    // Only one bounded batch is in flight. Do not fill the engine with invisible work.
                    while (!abort.signal.aborted) {
                        const groups = nextTranslationBatch(body, translator.batchCharacters);
                        const nodes = groups.flat();
                        if (nodes.length === 0) return;
                        const groupOf = new Map(groups.flatMap((group) => group.map((node) => [node, group] as const)));
                        const completed = new Map<Text, string>();
                        await translator.translate(
                            nodes.map((node) => node.data),
                            {
                                signal: abort.signal,
                                onResult: ({ index, text }) => {
                                    const node = nodes[index];
                                    if (!node || abort.signal.aborted) return;
                                    completed.set(node, text);
                                    const group = groupOf.get(node) ?? [];
                                    // A paragraph appears together; other paragraphs do not wait for it.
                                    if (group.every((part) => completed.has(part))) {
                                        applyVisibleTexts(
                                            body,
                                            group.map((part) => ({ node: part, text: completed.get(part)! }))
                                        );
                                    }
                                }
                            }
                        );
                    }
                } catch (error) {
                    if (!abort.signal.aborted)
                        notify(error instanceof Error ? error.message : "Translation failed", { error: true });
                    abort.abort();
                } finally {
                    work.running = false;
                }
            };
            const schedule = () => {
                cancelAnimationFrame(work.frame);
                work.frame = requestAnimationFrame(() => void pump());
            };
            articleScroller()?.addEventListener("scroll", schedule, { passive: true, signal: abort.signal });
            window.addEventListener("resize", schedule, { passive: true, signal: abort.signal });
            abort.signal.addEventListener("abort", () => cancelAnimationFrame(work.frame), { once: true });
            await pump();
        } catch (error) {
            if (!abort.signal.aborted)
                notify(error instanceof Error ? error.message : "Translation failed", { error: true });
        }
    };

    const toggle = async (focusedItemId: string | undefined): Promise<void> => {
        if (mode.enabled) {
            off();
            restoreOriginals(document);
            notify("Translate mode: OFF");
            return;
        }
        mode.enabled = true;
        notify("Translate mode: ON");
        if (focusedItemId) await translate(focusedItemId);
    };

    return { enabled: () => mode.enabled, off, toggle, translate };
}
