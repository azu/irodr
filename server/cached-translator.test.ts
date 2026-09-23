import { describe, expect, it } from "vite-plus/test";
import { createCachedTranslator } from "./cached-translator.ts";
import type { TranslationResult } from "../src/lib/translation-stream.ts";

function fixture(limits: Parameters<typeof createCachedTranslator>[1] = {}) {
    const calls: string[][] = [];
    const translator = createCachedTranslator(
        {
            translate: (texts, _source, target) => {
                calls.push([...texts]);
                return Promise.resolve(texts.map((text) => `[${target}] ${text}`));
            },
            translateStream: async (texts, _source, target, { onResult }) => {
                calls.push([...texts]);
                for (const [index, text] of [...texts.entries()].toReversed())
                    onResult({ index, text: `[${target}] ${text}` });
            }
        },
        limits
    );
    return { translator, calls };
}

describe("translation cache", () => {
    it("reuses complete translations and deduplicates identical texts in a batch", async () => {
        const { translator, calls } = fixture();
        expect(await translator.translate(["one", "one", "two"], "en", "ja")).toEqual([
            "[ja] one",
            "[ja] one",
            "[ja] two"
        ]);
        expect(await translator.translate(["two", "one"], "en", "ja")).toEqual(["[ja] two", "[ja] one"]);
        expect(calls).toEqual([["one", "two"]]);
    });

    it("immediately emits cached texts and remaps indices for out-of-order misses", async () => {
        const { translator, calls } = fixture();
        await translator.translate(["cached"], "en", "ja");
        const results: TranslationResult[] = [];
        await translator.translateStream!(["new", "cached", "another", "new"], "en", "ja", {
            onResult: (result) => {
                results.push(result);
            }
        });
        expect(results).toEqual([
            { index: 1, text: "[ja] cached" },
            { index: 2, text: "[ja] another" },
            { index: 0, text: "[ja] new" },
            { index: 3, text: "[ja] new" }
        ]);
        expect(calls).toEqual([["cached"], ["new", "another"]]);
    });

    it("separates source and target languages", async () => {
        const { translator, calls } = fixture();
        await translator.translate(["text"], "en", "ja");
        await translator.translate(["text"], "en", "fr");
        await translator.translate(["text"], "de", "ja");
        expect(calls).toHaveLength(3);
    });

    it("evicts the least recently used entry", async () => {
        const { translator, calls } = fixture({ maxEntries: 2 });
        await translator.translate(["one", "two"], "en", "ja");
        await translator.translate(["one"], "en", "ja");
        await translator.translate(["three"], "en", "ja");
        await translator.translate(["one"], "en", "ja");
        await translator.translate(["two"], "en", "ja");
        expect(calls).toEqual([["one", "two"], ["three"], ["two"]]);
    });

    it("does not cache an oversized text or an aborted request", async () => {
        const { translator, calls } = fixture({ maxCharacters: 1 });
        await translator.translate(["large"], "en", "ja");
        await translator.translate(["large"], "en", "ja");
        const abort = new AbortController();
        abort.abort();
        await expect(
            translator.translateStream!(["cancelled"], "en", "ja", { signal: abort.signal, onResult: () => undefined })
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(calls).toEqual([["large"], ["large"]]);
    });

    it("does not cache errors and does not advertise streaming for a legacy backend", async () => {
        const calls: string[][] = [];
        const translator = createCachedTranslator({
            translate: (texts) => {
                calls.push([...texts]);
                return calls.length === 1 ? Promise.reject(new Error("failed")) : Promise.resolve(["translated"]);
            }
        });
        expect(translator.translateStream).toBeUndefined();
        await expect(translator.translate(["text"], "en", "ja")).rejects.toThrow("failed");
        expect(await translator.translate(["text"], "en", "ja")).toEqual(["translated"]);
        expect(calls).toHaveLength(2);
    });
});
