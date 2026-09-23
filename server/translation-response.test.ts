import { describe, expect, it } from "vite-plus/test";
import { readTranslationStream, type TranslationResult } from "../src/lib/translation-stream.ts";
import { translationResponse } from "./translation-response.ts";

describe("streaming HTTP response", () => {
    it("does not wait for the translator to finish before sending the first result", async () => {
        const release = Promise.withResolvers<void>();
        const first = Promise.withResolvers<void>();
        const results: TranslationResult[] = [];
        const response = translationResponse(new AbortController().signal, async ({ onResult }) => {
            onResult({ index: 0, text: "first" });
            await release.promise;
            onResult({ index: 1, text: "second" });
        });
        const reading = readTranslationStream(response, 2, {
            onResult: (result) => {
                results.push(result);
                first.resolve();
            }
        });
        await first.promise;
        expect(results).toEqual([{ index: 0, text: "first" }]);
        release.resolve();
        await reading;
        expect(results).toHaveLength(2);
    });

    for (const source of ["request", "reader"] as const) {
        it(`cancels the translator when the ${source} is aborted`, async () => {
            const abort = new AbortController();
            const cancelled = Promise.withResolvers<void>();
            const response = translationResponse(
                abort.signal,
                ({ signal }) =>
                    new Promise((_resolve, reject) => {
                        signal?.addEventListener(
                            "abort",
                            () => {
                                cancelled.resolve();
                                reject(signal.reason);
                            },
                            { once: true }
                        );
                    })
            );
            if (source === "request") abort.abort();
            else await response.body?.cancel();
            await cancelled.promise;
        });
    }
});
