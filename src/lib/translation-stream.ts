/** One completed input text, not a token or a partial sentence. */
export interface TranslationResult {
    readonly index: number;
    readonly text: string;
}

export interface TranslationStreamOptions {
    readonly onResult: (result: TranslationResult) => void;
    readonly signal?: AbortSignal;
}

export type TranslateStream = (
    texts: readonly string[],
    sourceLanguage: string,
    targetLanguage: string,
    options: TranslationStreamOptions
) => Promise<void>;

export function parseTranslationResult(value: unknown, count: number): TranslationResult | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const result = value as Record<string, unknown>;
    return typeof result.index === "number" &&
        Number.isInteger(result.index) &&
        result.index >= 0 &&
        result.index < count &&
        typeof result.text === "string"
        ? { index: result.index, text: result.text }
        : undefined;
}

/** NDJSON can be split anywhere by the network, including inside a UTF-8 character. */
export async function readTranslationStream(
    response: Response,
    count: number,
    { onResult, signal }: TranslationStreamOptions
): Promise<void> {
    if (!response.body) throw new Error("Translation stream has no body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const received = new Set<number>();
    const pending = { text: "", done: false };
    const cancel = () => void reader.cancel().catch(() => undefined);
    signal?.addEventListener("abort", cancel, { once: true });
    const accept = (line: string) => {
        if (!line.trim()) return;
        signal?.throwIfAborted();
        if (pending.done) throw new Error("Unexpected data after translation finished");
        const message: unknown = JSON.parse(line);
        if (typeof message === "object" && message !== null) {
            if ("error" in message && typeof message.error === "string") throw new Error(message.error);
            if ("done" in message && message.done === true) {
                if (received.size !== count) throw new Error("Translation stream is missing results");
                pending.done = true;
                return;
            }
        }
        const result = parseTranslationResult(message, count);
        if (!result || received.has(result.index)) throw new Error("Invalid translation stream result");
        received.add(result.index);
        onResult(result);
    };
    try {
        signal?.throwIfAborted();
        for (;;) {
            const { done, value } = await reader.read();
            signal?.throwIfAborted();
            const lines = (pending.text + decoder.decode(value, { stream: !done })).split("\n");
            pending.text = lines.pop() ?? "";
            for (const line of lines) accept(line);
            if (done) {
                accept(pending.text);
                if (!pending.done) throw new Error("Translation stream ended before completion");
                return;
            }
        }
    } finally {
        signal?.removeEventListener("abort", cancel);
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}
