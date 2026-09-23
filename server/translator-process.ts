import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Translator } from "./handler.ts";

/**
 * Talks to a translation helper (swift/irodr-translate) over stdin/stdout, one JSON object per line:
 *
 *     → {"id":1,"texts":["Hello"],"sourceLanguage":"en","targetLanguage":"ja"}
 *     ← {"id":1,"texts":["こんにちは"]}   or   {"id":1,"error":"..."}
 *
 * The helper starts on the first request and is restarted after it exits.
 */
export interface TranslatorProcess extends Translator {
    close: () => void;
}

interface Pending {
    resolve: (texts: string[]) => void;
    reject: (error: Error) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function createTranslatorProcess(command: string, args: readonly string[] = []): TranslatorProcess {
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
        pending.delete(message.id);
        if (Array.isArray(message.texts) && message.texts.every((text) => typeof text === "string")) {
            entry.resolve(message.texts);
        } else {
            entry.reject(new Error(typeof message.error === "string" ? message.error : "Translation failed"));
        }
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
            if (current.child === child) current.child = undefined;
            failAll(new Error(`Translation helper ${reason}`));
        };
        child.on("error", (error) => exited(`failed to start: ${error.message}`));
        child.on("exit", (code, signal) => exited(`exited (${signal ?? code})`));
        return child;
    };

    const translate = (texts: readonly string[], sourceLanguage: string, targetLanguage: string) =>
        new Promise<string[]>((resolve, reject) => {
            const child = (current.child ??= start());
            const id = current.nextId;
            current.nextId = id + 1;
            pending.set(id, { resolve, reject });
            child.stdin.write(`${JSON.stringify({ id, texts, sourceLanguage, targetLanguage })}\n`);
        });

    const close = () => {
        const { child } = current;
        current.child = undefined;
        child?.stdin.end();
        child?.kill();
        failAll(new Error("Translation helper closed"));
    };

    return { translate, close };
}
