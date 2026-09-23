import { describe, expect, it } from "vite-plus/test";
import { readTranslationStream, type TranslationResult } from "./translation-stream.ts";

const encode = (message: unknown) => new TextEncoder().encode(`${JSON.stringify(message)}\n`);

describe("translation stream", () => {
    it("delivers a result before the batch finishes and matches out-of-order indices", async () => {
        const source = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
        const stream = new ReadableStream<Uint8Array>({
            start: (controller) => {
                source.resolve(controller);
            }
        });
        const results: TranslationResult[] = [];
        const first = Promise.withResolvers<void>();
        const reading = readTranslationStream(new Response(stream), 2, {
            onResult: (result) => {
                results.push(result);
                first.resolve();
            }
        });
        const writer = await source.promise;
        writer.enqueue(encode({ index: 1, text: "二番目" }));
        await first.promise;
        expect(results).toEqual([{ index: 1, text: "二番目" }]);
        writer.enqueue(encode({ index: 0, text: "最初" }));
        writer.enqueue(encode({ done: true }));
        writer.close();
        await reading;
        expect(results.map((result) => result.index)).toEqual([1, 0]);
    });

    it("decodes arbitrary byte boundaries including Japanese characters", async () => {
        const bytes = new TextEncoder().encode('{"index":0,"text":"日本語"}\n{"done":true}\n');
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
                controller.close();
            }
        });
        const results: TranslationResult[] = [];
        await readTranslationStream(new Response(stream), 1, {
            onResult: (result) => {
                results.push(result);
            }
        });
        expect(results).toEqual([{ index: 0, text: "日本語" }]);
    });

    for (const [name, body] of [
        ["truncated", '{"index":0,"text":"one"}\n'],
        ["missing", '{"done":true}\n'],
        ["duplicate", '{"index":0,"text":"one"}\n{"index":0,"text":"again"}\n'],
        ["out of range", '{"index":1,"text":"one"}\n'],
        ["malformed", "not json\n"],
        ["extra", '{"index":0,"text":"one"}\n{"done":true}\n{"done":true}\n']
    ]) {
        it(`rejects a ${name} stream`, async () => {
            await expect(readTranslationStream(new Response(body), 1, { onResult: () => undefined })).rejects.toThrow();
        });
    }

    it("surfaces a mid-stream error while keeping delivered results", async () => {
        const results: TranslationResult[] = [];
        await expect(
            readTranslationStream(new Response('{"index":0,"text":"ok"}\n{"error":"translation failed"}\n'), 2, {
                onResult: (result) => {
                    results.push(result);
                }
            })
        ).rejects.toThrow("translation failed");
        expect(results).toEqual([{ index: 0, text: "ok" }]);
    });

    it("cancels a pending reader when the user turns translation off", async () => {
        const cancelled = Promise.withResolvers<void>();
        const abort = new AbortController();
        const stream = new ReadableStream<Uint8Array>({
            cancel: () => {
                cancelled.resolve();
            }
        });
        const reading = readTranslationStream(new Response(stream), 1, {
            signal: abort.signal,
            onResult: () => undefined
        });
        const rejected = expect(reading).rejects.toMatchObject({ name: "AbortError" });
        abort.abort();
        await rejected;
        await cancelled.promise;
    });
});
