import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { parseSegments, type TranslationSegment } from "../src/lib/translation-segment.ts";
import { parseTranslationResult, type TranslateStream } from "../src/lib/translation-stream.ts";
import type { Translator } from "./handler.ts";

/**
 * Talks to a translation helper (swift/irodr-translate) over stdin/stdout, one JSON object per line:
 *
 *     → {"id":1,"texts":["Hello"],"sourceLanguage":"en","targetLanguage":"ja"}
 *     ← {"id":1,"texts":["こんにちは"]}   or   {"id":1,"error":"..."}
 *     → {"id":2,"segments":[{"runs":[{"text":"Read "},{"text":"the docs","tag":1}]}],"sourceLanguage":"en",...}
 *     ← {"id":2,"segments":[{"runs":[{"text":"ドキュメント","tag":1},{"text":"を読む"}]}]}
 *
 * The helper starts on the first request and is restarted after it exits. A request without a response
 * within `timeout` fails.
 */
export interface TranslatorProcess extends Required<Translator> {
    close: () => void;
}

interface Pending {
    resolve: (message: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    progress: (message: Record<string, unknown>) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function createTranslatorProcess(
    command: string,
    args: readonly string[] = [],
    processOptions: { timeout?: number } = {}
): TranslatorProcess {
    const timeout = processOptions.timeout ?? 60_000;
    const pending = new Map<number, Pending>();
    const current: { child: ChildProcessWithoutNullStreams | undefined; nextId: number } = {
        child: undefined,
        nextId: 1
    };

    const failAll = (error: Error) => {
        for (const entry of pending.values()) entry.reject(error);
        pending.clear();
    };

    const onLine = (line: string) => {
        const message: unknown = JSON.parse(line);
        if (!isRecord(message) || typeof message.id !== "number") return;
        const entry = pending.get(message.id);
        if (!entry) return;
        if (typeof message.error === "string") entry.reject(new Error(message.error));
        else if ("index" in message) {
            try {
                entry.progress(message);
            } catch (error) {
                entry.reject(error instanceof Error ? error : new Error("Invalid translation result"));
            }
        } else entry.resolve(message);
    };

    const start = (): ChildProcessWithoutNullStreams => {
        const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
        child.stderr.on("data", (chunk: Buffer) => console.error(`[translator] ${chunk.toString("utf8").trimEnd()}`));
        createInterface({ input: child.stdout }).on("line", (line) => {
            try {
                onLine(line);
            } catch (error) {
                console.error("[translator] invalid response", error);
            }
        });
        const exited = (reason: string) => {
            if (current.child !== child) return;
            current.child = undefined;
            failAll(new Error(`Translation helper ${reason}`));
        };
        child.on("error", (error) => exited(`failed to start: ${error.message}`));
        child.stdin.on("error", (error) => exited(`input failed: ${error.message}`));
        child.on("exit", (code, signal) => exited(`exited (${signal ?? code})`));
        return child;
    };

    const send = (
        request: Record<string, unknown>,
        options: { signal?: AbortSignal; progress?: Pending["progress"] } = {}
    ) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
            options.signal?.throwIfAborted();
            const child = (current.child ??= start());
            const id = current.nextId;
            current.nextId = id + 1;
            const cleanup = () => {
                clearTimeout(timer);
                options.signal?.removeEventListener("abort", cancel);
                pending.delete(id);
            };
            const stop = () => {
                if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify({ id, cancel: true })}\n`);
            };
            const cancel = () => {
                cleanup();
                stop();
                reject(options.signal?.reason ?? new Error("Translation cancelled"));
            };
            const timer = setTimeout(() => {
                cleanup();
                stop();
                reject(new Error("Translation helper did not respond"));
            }, timeout);
            pending.set(id, {
                resolve: (message) => {
                    cleanup();
                    resolve(message);
                },
                reject: (error) => {
                    cleanup();
                    stop();
                    reject(error);
                },
                progress:
                    options.progress ??
                    (() => {
                        throw new Error("Unexpected translation progress");
                    })
            });
            options.signal?.addEventListener("abort", cancel, { once: true });
            child.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
        });

    const translateStream: TranslateStream = async (texts, sourceLanguage, targetLanguage, options) => {
        const received = new Set<number>();
        const response = await send(
            { texts, sourceLanguage, targetLanguage, stream: true },
            {
                signal: options.signal,
                progress: (message) => {
                    const result = parseTranslationResult(message, texts.length);
                    if (!result || received.has(result.index)) throw new Error("Invalid translation result");
                    received.add(result.index);
                    options.onResult(result);
                }
            }
        );
        if (response.done !== true || received.size !== texts.length) {
            throw new Error("Translation helper returned an incomplete stream");
        }
    };

    const translate = async (texts: readonly string[], sourceLanguage: string, targetLanguage: string) => {
        const { texts: translated } = await send({ texts, sourceLanguage, targetLanguage });
        if (!Array.isArray(translated) || !translated.every((text) => typeof text === "string")) {
            throw new Error("Translation helper returned an unexpected response");
        }
        return translated;
    };

    const translateSegments = async (
        segments: readonly TranslationSegment[],
        sourceLanguage: string,
        targetLanguage: string
    ) => {
        const translated = parseSegments((await send({ segments, sourceLanguage, targetLanguage })).segments);
        if (!translated) throw new Error("Translation helper returned an unexpected response");
        return translated;
    };

    const close = () => {
        const { child } = current;
        current.child = undefined;
        child?.stdin.end();
        child?.kill();
        failAll(new Error("Translation helper closed"));
    };

    return { translate, translateSegments, translateStream, close };
}
