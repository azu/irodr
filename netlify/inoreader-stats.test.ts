import { describe, expect, it } from "vite-plus/test";
import { clientOf, countKeys, endpointOf, statsKey } from "./inoreader-stats.ts";

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
    });
});

describe("counts", () => {
    it("counts the requests of a day per client and endpoint", () => {
        const day = new Date("2026-10-27T12:00:00Z");
        const current = new Request("https://irodr.test/cors-proxy/x", { headers: { "X-Irodr-Client": "2" } });
        const keys = [
            statsKey(day, clientOf(current), "/reader/api/0/unread-count", "a"),
            statsKey(day, clientOf(current), "/reader/api/0/unread-count", "b"),
            statsKey(day, clientOf(new Request("https://irodr.test/")), "/reader/api/0/subscription/list", "c")
        ];
        expect(keys[0]).toBe("2026-10-27/2/reader/api/0/unread-count/a");
        expect(countKeys(keys)).toEqual({
            "2 /reader/api/0/unread-count": 2,
            "legacy /reader/api/0/subscription/list": 1
        });
    });
});
