import type { TranslationStreamOptions } from "../src/lib/translation-stream.ts";

/** Keep partial results on errors; an explicit terminal line distinguishes errors from a truncated connection. */
export function translationResponse(
    signal: AbortSignal,
    translate: (options: TranslationStreamOptions) => Promise<void>
): Response {
    const abort = new AbortController();
    const encoder = new TextEncoder();
    const connection = { cancelled: false };
    const cancel = () => abort.abort();
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            const write = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
            signal.addEventListener("abort", cancel, { once: true });
            if (signal.aborted) cancel();
            const run = async () => {
                try {
                    abort.signal.throwIfAborted();
                    await translate({
                        signal: abort.signal,
                        onResult: (result) => {
                            if (!abort.signal.aborted) write(result);
                        }
                    });
                    if (!abort.signal.aborted) write({ done: true });
                } catch (error) {
                    if (!abort.signal.aborted)
                        write({ error: error instanceof Error ? error.message : "Translation failed" });
                } finally {
                    signal.removeEventListener("abort", cancel);
                    if (!connection.cancelled) controller.close();
                }
            };
            void run();
        },
        cancel() {
            connection.cancelled = true;
            cancel();
        }
    });
    return new Response(body, {
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" }
    });
}
