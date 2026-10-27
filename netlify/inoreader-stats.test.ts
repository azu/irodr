import { describe, expect, it } from "vite-plus/test";
import { clientOf, endpointOf, statsKey } from "./inoreader-stats.ts";

describe("endpointOf", () => {
    it("drops stream IDs and queries, which can carry feed credentials", () => {
        expect(
            endpointOf(
                "https://www.inoreader.com/reader/api/0/stream/contents/feed%2Fhttps%3A%2F%2Fuser%3Apass%40example.com?n=20"
            )
        ).toBe("/reader/api/0/stream/contents");
        expect(
            endpointOf("https://www.inoreader.com/reader/api/0/stream/items/ids?s=user/-/state/com.google/starred")
        ).toBe("/reader/api/0/stream/items/ids");
        expect(endpointOf("https://www.inoreader.com/reader/api/0/unread-count")).toBe("/reader/api/0/unread-count");
        expect(endpointOf("https://www.inoreader.com/reader/api/0/subscription/list")).toBe(
            "/reader/api/0/subscription/list"
        );
        expect(endpointOf("https://www.inoreader.com/oauth2/token")).toBe("/oauth2/token");
        expect(endpointOf("https://www.inoreader.com/oauth2/secret-in-path")).toBe("/other");
        // Anyone can call the proxy: unknown long names must not fill the stats or exceed the 600-byte key limit.
        expect(endpointOf(`https://www.inoreader.com/reader/api/0/${"a".repeat(41)}`)).toBe("/other");
    });
});

describe("statsKey", () => {
    it("keys a request by UTC day, client and endpoint", () => {
        const day = new Date("2026-10-27T23:00:00Z");
        const current = new Request("https://irodr.test/cors-proxy/x", { headers: { "X-Irodr-Client": "2" } });
        expect(statsKey(day, clientOf(current), "/reader/api/0/unread-count", "a")).toBe(
            "2026-10-27/2/reader/api/0/unread-count/a"
        );
        expect(
            statsKey(day, clientOf(new Request("https://irodr.test/")), "/reader/api/0/subscription/list", "b")
        ).toBe("2026-10-27/legacy/reader/api/0/subscription/list/b");
    });
});
