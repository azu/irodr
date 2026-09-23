import { afterAll, describe, expect, it } from "vite-plus/test";
import { createLocalServerHandler, type LocalServerOptions } from "./handler.ts";
import { createTranslatorProcess } from "./translator-process.ts";

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
        expect(await response.json()).toEqual({ name: "irodr-local", version: "1.2.3", features: ["translate"] });
        const withoutTranslator = await handler({ translator: undefined })(new Request(`${ORIGIN}/api/local`));
        expect(await withoutTranslator.json()).toMatchObject({ features: [] });
    });

    it("translates with the helper process", async () => {
        const response = await handler()(translateRequest(["Hello", "World"]));
        expect(await response.json()).toEqual({ texts: ["[ja] Hello", "[ja] World"] });
    });

    it("returns the helper's error", async () => {
        const response = await handler()(translateRequest(["fail"]));
        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ error: "language package is not installed" });
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
