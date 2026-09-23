import { afterAll, describe, expect, it } from "vite-plus/test";
import { createLocalServerHandler, type LocalServerOptions } from "./handler.ts";
import { createTranslatorProcess } from "./translator-process.ts";
import { createLocalApi } from "../src/lib/local-api.ts";
import type { TranslationResult } from "../src/lib/translation-stream.ts";

const ORIGIN = "http://127.0.0.1:18888";
const encode = (text: string) => new TextEncoder().encode(text);

const translator = createTranslatorProcess(process.execPath, [new URL("fake-translator.ts", import.meta.url).pathname]);
afterAll(() => translator.close());

function handler(options: Partial<LocalServerOptions> = {}) {
    return createLocalServerHandler({
        origins: [ORIGIN, "http://localhost:18888"],
        version: "1.2.3",
        assets: {
            get: (path) =>
                path === "/index.html"
                    ? { body: encode("<!doctype html>"), contentType: "text/html; charset=utf-8" }
                    : undefined
        },
        translator,
        fetch: () => Promise.reject(new Error("unexpected fetch")),
        ...options
    });
}

const translateRequest = (texts: unknown, headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}/api/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
        body: JSON.stringify({ texts, sourceLanguage: "en", targetLanguage: "ja" })
    });

describe("local server handler", () => {
    it("serves the app", async () => {
        const response = await handler()(new Request(`${ORIGIN}/`));
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect(await response.text()).toBe("<!doctype html>");
        expect((await handler()(new Request(`${ORIGIN}/missing.js`))).status).toBe(404);
    });

    it("describes itself and its features", async () => {
        const response = await handler()(new Request(`${ORIGIN}/api/local`));
        expect(await response.json()).toEqual({
            name: "irodr-local",
            version: "1.2.3",
            features: ["translate", "translate-segments", "translate-stream"]
        });
        const withoutTranslator = await handler({ translator: undefined })(new Request(`${ORIGIN}/api/local`));
        expect(await withoutTranslator.json()).toMatchObject({ features: [] });
    });

    it("translates with the helper process", async () => {
        const response = await handler()(translateRequest(["Hello", "World"]));
        expect(await response.json()).toEqual({ texts: ["[ja] Hello", "[ja] World"] });
    });

    it("translates segments with the helper process", async () => {
        const segments = [{ runs: [{ text: "Read " }, { text: "the docs", tag: 1 }] }];
        const response = await handler()(
            new Request(`${ORIGIN}/api/translate`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Origin: ORIGIN },
                body: JSON.stringify({ segments, sourceLanguage: "en", targetLanguage: "ja" })
            })
        );
        expect(await response.json()).toEqual({
            segments: [{ runs: [{ text: "[ja] " }, { text: "the docs", tag: 1 }, { text: "Read " }] }]
        });
    });

    it("returns the helper's error", async () => {
        const response = await handler()(translateRequest(["fail"]));
        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ error: "language package is not installed" });
    });

    it("streams helper results through the HTTP API, preserving their indices", async () => {
        const serve = handler();
        const api = createLocalApi({ baseUrl: ORIGIN, fetch: (input, init) => serve(new Request(input, init)) });
        const results: TranslationResult[] = [];
        await api.translateStream(["Hello", "World"], "en", "ja", {
            onResult: (result) => {
                results.push(result);
            }
        });
        expect(results).toEqual([
            { index: 1, text: "[ja] World" },
            { index: 0, text: "[ja] Hello" }
        ]);
    });

    it("returns streaming errors instead of silently finishing", async () => {
        const serve = handler();
        const api = createLocalApi({ baseUrl: ORIGIN, fetch: (input, init) => serve(new Request(input, init)) });
        await expect(api.translateStream(["fail"], "en", "ja", { onResult: () => undefined })).rejects.toThrow(
            "language package is not installed"
        );
    });

    it("does not advertise streaming for older translators", async () => {
        const serve = handler({ translator: { translate: translator.translate } });
        expect(await (await serve(new Request(`${ORIGIN}/api/local`))).json()).toMatchObject({
            features: ["translate"]
        });
        const response = await serve(
            new Request(`${ORIGIN}/api/translate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ texts: ["Hello"], sourceLanguage: "en", targetLanguage: "ja", stream: true })
            })
        );
        expect(response.status).toBe(501);
    });

    it("validates translation requests", async () => {
        expect((await handler()(translateRequest("Hello"))).status).toBe(400);
        expect((await handler()(translateRequest(["Hello"], { "Content-Type": "text/plain" }))).status).toBe(415);
    });

    it("refuses other sites and host names", async () => {
        const crossSite = await handler()(translateRequest(["Hello"], { Origin: "https://evil.example" }));
        expect(crossSite.status).toBe(403);
        // DNS rebinding: another name pointing at 127.0.0.1.
        const rebound = await handler()(new Request("http://evil.example:18888/api/local"));
        expect(rebound.status).toBe(403);
    });

    it("proxies Inoreader only", async () => {
        const requests: Request[] = [];
        const proxied = handler({
            fetch: (input, init) => {
                requests.push(new Request(input, init));
                return Promise.resolve(
                    new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })
                );
            }
        });
        const response = await proxied(
            new Request(`${ORIGIN}/cors-proxy/https://www.inoreader.com/reader/api/0/user-info?x=1`, {
                headers: { Authorization: "Bearer token", Cookie: "secret=1" }
            })
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(requests.map((request) => request.url)).toEqual([
            "https://www.inoreader.com/reader/api/0/user-info?x=1"
        ]);
        expect(requests[0]?.headers.get("authorization")).toBe("Bearer token");
        expect(requests[0]?.headers.get("cookie")).toBeNull();

        const other = await proxied(new Request(`${ORIGIN}/cors-proxy/https://example.com/`));
        expect(other.status).toBe(400);
        expect(requests).toHaveLength(1);
    });
});

describe("translator process", () => {
    it("cancels one helper request and ignores late results without affecting the next request", async () => {
        const helper = createTranslatorProcess(process.execPath, [
            "-e",
            `
            const cancelled = new Set();
            const write = value => process.stdout.write(JSON.stringify(value) + '\\n');
            require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
                const request = JSON.parse(line);
                if (request.cancel) {
                    cancelled.add(request.id);
                    write({ id: request.id, index: 1, text: 'late' });
                    write({ id: request.id, done: true });
                } else if (request.stream) {
                    write({ id: request.id, index: 0, text: 'first' });
                } else {
                    write({ id: request.id, texts: [String(cancelled.size)] });
                }
            });
        `
        ]);
        try {
            const abort = new AbortController();
            const results: TranslationResult[] = [];
            await expect(
                helper.translateStream(["one", "two"], "en", "ja", {
                    signal: abort.signal,
                    onResult: (result) => {
                        results.push(result);
                        abort.abort();
                    }
                })
            ).rejects.toMatchObject({ name: "AbortError" });
            expect(await helper.translate(["inspect"], "en", "ja")).toEqual(["1"]);
            expect(results).toEqual([{ index: 0, text: "first" }]);
        } finally {
            helper.close();
        }
    });

    it("rejects incomplete streams from the helper", async () => {
        const helper = createTranslatorProcess(process.execPath, [
            "-e",
            `
            require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
                const request = JSON.parse(line);
                if (!request.cancel) process.stdout.write(JSON.stringify({id: request.id, done: true}) + '\\n');
            });
        `
        ]);
        try {
            await expect(helper.translateStream(["one"], "en", "ja", { onResult: () => undefined })).rejects.toThrow(
                "incomplete stream"
            );
        } finally {
            helper.close();
        }
    });
    it("fails a request the helper never answers", async () => {
        const silent = createTranslatorProcess(process.execPath, ["-e", "process.stdin.resume()"], { timeout: 50 });
        await expect(silent.translate(["Hello"], "en", "ja")).rejects.toThrow("Translation helper did not respond");
        silent.close();
    });
});
