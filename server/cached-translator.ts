import { createStore } from "../src/lib/store.ts";
import type { TranslateStream } from "../src/lib/translation-stream.ts";
import type { Translator } from "./handler.ts";

interface Entry {
    readonly key: string;
    readonly text: string;
    readonly size: number;
}

const keyFor = (source: string, target: string, text: string) => JSON.stringify([source, target, text]);

/** Process-local, bounded LRU cache. Article text is never persisted to disk. */
export function createCachedTranslator(
    translator: Translator,
    { maxCharacters = 500_000, maxEntries = 1000 }: { maxCharacters?: number; maxEntries?: number } = {}
): Translator {
    const cache = createStore<readonly Entry[]>([]);
    const get = (key: string): string | undefined => {
        const entry = cache.get().find((candidate) => candidate.key === key);
        if (!entry) return undefined;
        cache.update((entries) => [...entries.filter((candidate) => candidate.key !== key), entry]);
        return entry.text;
    };
    const put = (key: string, text: string) => {
        const entry = { key, text, size: key.length + text.length };
        if (entry.size > maxCharacters || maxEntries < 1) return;
        cache.update((entries) => {
            const candidates = [...entries.filter((candidate) => candidate.key !== key), entry];
            const bounded = candidates.reduceRight<{ start: number; size: number; full: boolean }>(
                (state, candidate, index) => {
                    if (state.full) return state;
                    return state.size + candidate.size > maxCharacters || candidates.length - index > maxEntries
                        ? { start: state.start, size: state.size, full: true }
                        : { start: index, size: state.size + candidate.size, full: false };
                },
                { start: candidates.length, size: 0, full: false }
            );
            return candidates.slice(bounded.start);
        });
    };

    const stream: TranslateStream = async (texts, sourceLanguage, targetLanguage, options) => {
        options.signal?.throwIfAborted();
        const entries = texts.map((source, index) => {
            const key = keyFor(sourceLanguage, targetLanguage, source);
            return { source, index, key, text: get(key) };
        });
        for (const entry of entries) {
            options.signal?.throwIfAborted();
            if (entry.text !== undefined) options.onResult({ index: entry.index, text: entry.text });
        }
        options.signal?.throwIfAborted();
        const missing = [...new Set(entries.filter((entry) => entry.text === undefined).map((entry) => entry.source))];
        if (missing.length === 0) return;
        const received = new Set<number>();
        const onResult: Parameters<TranslateStream>[3]["onResult"] = ({ index, text }) => {
            options.signal?.throwIfAborted();
            const source = missing[index];
            if (source === undefined || received.has(index)) throw new Error("Invalid translation cache result");
            received.add(index);
            put(keyFor(sourceLanguage, targetLanguage, source), text);
            for (const entry of entries) {
                if (entry.text === undefined && entry.source === source) options.onResult({ index: entry.index, text });
            }
        };
        if (translator.translateStream) {
            await translator.translateStream(missing, sourceLanguage, targetLanguage, { ...options, onResult });
        } else {
            const results = await translator.translate(missing, sourceLanguage, targetLanguage);
            results.forEach((text, index) => onResult({ index, text }));
        }
        if (received.size !== missing.length) throw new Error("Translation returned incomplete results");
    };

    return {
        ...translator,
        translate: async (texts, sourceLanguage, targetLanguage) => {
            const results = new Map<number, string>();
            await stream(texts, sourceLanguage, targetLanguage, {
                onResult: ({ index, text }) => {
                    results.set(index, text);
                }
            });
            return texts.map((text, index) => results.get(index) ?? text);
        },
        ...(translator.translateStream ? { translateStream: stream } : {})
    };
}
