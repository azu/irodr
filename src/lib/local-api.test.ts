import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { startFakeApi } from "../../e2e/fake-api/server.ts";
import { createLocalApi, parseLocalApiInfo } from "./local-api.ts";

const server = await startFakeApi();
afterAll(() => server.close());
beforeEach(() => server.reset());

const localApi = (baseUrl = `${server.origin}/local`) => createLocalApi({ baseUrl, fetch });

describe("parseLocalApiInfo", () => {
    it("accepts the irodr-local info", () => {
        const info = parseLocalApiInfo({ name: "irodr-local", version: "1.0.0", features: ["translate", 1] });
        expect(info?.version).toBe("1.0.0");
        expect([...(info?.features ?? [])]).toEqual(["translate"]);
    });

    it("rejects other bodies", () => {
        expect(parseLocalApiInfo(undefined)).toBeUndefined();
        expect(parseLocalApiInfo({ name: "other", features: [] })).toBeUndefined();
        expect(parseLocalApiInfo({ name: "irodr-local" })).toBeUndefined();
    });
});

describe("createLocalApi", () => {
    it("detects the server once", async () => {
        const api = localApi();
        expect((await api.info())?.features.has("translate")).toBe(true);
        await api.info();
        expect(server.log().filter((entry) => entry.path === "/api/local")).toHaveLength(1);
    });

    it("reports no server on a host without one", async () => {
        server.reset({ local: { enabled: false } });
        expect(await localApi().info()).toBeUndefined();
    });

    it("reports no server when the host is unreachable", async () => {
        expect(await localApi("http://127.0.0.1:1").info()).toBeUndefined();
    });

    it("translates texts in order", async () => {
        expect(await localApi().translate(["Hello", "World"], "en", "ja")).toEqual(["[ja] Hello", "[ja] World"]);
    });

    it("surfaces the server's error message", async () => {
        server.reset({ local: { translateError: "language package is not installed: en -> ja" } });
        await expect(localApi().translate(["Hello"], "en", "ja")).rejects.toThrow(
            "language package is not installed: en -> ja"
        );
    });
});
