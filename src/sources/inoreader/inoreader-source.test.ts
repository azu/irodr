import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { inoreaderSubscriptions } from "../../../e2e/fake-api/fixtures.ts";
import { startFakeApi } from "../../../e2e/fake-api/server.ts";
import { InoreaderSource } from "./inoreader-source.ts";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
    readonly map = new Map<string, string>();
    getItem = (key: string) => this.map.get(key) ?? null;
    setItem = (key: string, value: string) => void this.map.set(key, value);
    removeItem = (key: string) => void this.map.delete(key);
}

const ALPHA = "feed/https://alpha.example.com/rss";
const REDIRECT = "https://irodr.test/";

const server = await startFakeApi();
afterAll(() => server.close());
beforeEach(() => server.reset({ inoreader: { subscriptions: inoreaderSubscriptions() } }));

const clock = { offset: 0 };
beforeEach(() => {
    clock.offset = 0;
});

function createSource(storage = new MemoryStorage()) {
    const navigations: string[] = [];
    const source = new InoreaderSource({
        baseUrl: `${server.origin}/inoreader`,
        corsProxy: "",
        redirectUri: REDIRECT,
        defaultClient: { clientId: "e2e-client", clientSecret: "e2e-secret" },
        fetch: (input, init) => fetch(input, init),
        storage,
        session: new MemoryStorage(),
        now: () => Date.now() + clock.offset,
        navigate: (url) => navigations.push(url)
    });
    return { source, storage, navigations };
}

/** Follow the authorization redirect like a user clicking "Authorize". */
async function authorize(authorizeUrl: string): Promise<URL> {
    const page = await (await fetch(authorizeUrl)).text();
    const href = /id="authorize" href="([^"]+)"/.exec(page)?.[1]?.replaceAll("&#38;", "&");
    if (!href) throw new Error("No authorize link");
    return new URL(href);
}

async function connected() {
    const setup = createSource();
    await setup.source.runAction("connect", { clientId: "", clientSecret: "" });
    const callback = await authorize(setup.navigations[0] ?? "");
    expect(await setup.source.restore(callback)).toEqual({ consumedUrl: true });
    return setup;
}

describe("InoreaderSource", () => {
    it("connects with the OAuth authorization code flow", async () => {
        const { source, storage } = await connected();
        expect(source.getSnapshot().connected).toBe(true);
        const token = JSON.parse(storage.getItem("inoreader-token") ?? "{}");
        expect(token).toMatchObject({ tokenType: "Bearer" });
        expect(token.accessToken).toMatch(/^access-/);
        expect(token.refreshToken).toMatch(/^refresh-/);
    });

    it("rejects a callback with another state", async () => {
        const { source, navigations } = createSource();
        await source.runAction("connect", {});
        const callback = await authorize(navigations[0] ?? "");
        callback.searchParams.set("state", "forged");
        await source.restore(callback);
        expect(source.getSnapshot().connected).toBe(false);
        expect(source.getSnapshot().status.message).toMatch(/state did not match/);
    });

    it("uses a custom client when one is entered", async () => {
        server.reset({ inoreader: { subscriptions: [], clientId: "mine", clientSecret: "secret" } });
        const { source, navigations } = createSource();
        await source.runAction("connect", { clientId: "mine", clientSecret: "secret" });
        expect(new URL(navigations[0] ?? "").searchParams.get("client_id")).toBe("mine");
        await source.restore(await authorize(navigations[0] ?? ""));
        expect(source.getSnapshot().connected).toBe(true);
        expect(source.getSnapshot().settings.fields.map((field) => field.value)).toEqual(["mine", "secret"]);
    });

    it("lists subscriptions with unread counts", async () => {
        const { source } = await connected();
        await source.sync();
        const feeds = source.getSnapshot().feeds;
        expect(feeds.map((feed) => [feed.title, feed.category, feed.unreadCount])).toEqual([
            ["Alpha Blog", "Blogs", 3],
            ["Beta Blog", "Blogs", 1],
            ["Gamma News", "News", 5],
            ["Already Read", "News", 0],
            ["Delta Tech", "Tech", 1]
        ]);
        expect(feeds[0]).toMatchObject({
            id: `inoreader:${ALPHA}`,
            feedUrl: "https://alpha.example.com/rss",
            editUrl: `${server.origin}/inoreader/feed/${encodeURIComponent("https://alpha.example.com/rss")}`
        });
        // Unchanged feeds keep their identity across syncs.
        await source.sync();
        expect(source.getSnapshot().feeds[0]).toBe(feeds[0]);
    });

    it("loads items page by page with read state", async () => {
        const { source } = await connected();
        const first = await source.loadItems("inoreader:feed/https://gamma.example.com/rss", { count: 20 });
        expect(first.items).toHaveLength(20);
        expect(first.items.filter((item) => item.unread)).toHaveLength(5);
        expect(first.continuation).toBe("20");
        const rest = await source.loadItems("inoreader:feed/https://gamma.example.com/rss", {
            count: 20,
            continuation: first.continuation
        });
        expect(rest.items.map((item) => item.title).at(-1)).toBe("gamma article 25");
        expect(rest.continuation).toBeUndefined();
    });

    it("marks read through the newest loaded item, leaving later arrivals unread", async () => {
        const { source } = await connected();
        await source.sync();
        const page = await source.loadItems(`inoreader:${ALPHA}`, { count: 20 });
        server.inoreader.addItems(ALPHA, [{ id: "late", title: "late", published: Math.floor(Date.now() / 1000) }]);
        await source.markRead(`inoreader:${ALPHA}`, page.items);
        expect(server.inoreader.unreadCount(ALPHA)).toBe(1);
        expect(source.getSnapshot().feeds.find((feed) => feed.title === "Alpha Blog")?.unreadCount).toBe(0);
        await source.sync();
        expect(source.getSnapshot().feeds.find((feed) => feed.title === "Alpha Blog")?.unreadCount).toBe(1);
    });

    it("shows 0 until Inoreader counts reflect a mark-read, but not forever", async () => {
        const { source } = await connected();
        await source.sync();
        const alpha = () => source.getSnapshot().feeds.find((feed) => feed.title === "Alpha Blog")?.unreadCount;
        const page = await source.loadItems(`inoreader:${ALPHA}`, { count: 20 });
        await source.markRead(`inoreader:${ALPHA}`, page.items);
        // The unread count lags behind the mark-read request.
        for (const item of server.inoreader.streams.get(ALPHA)?.items ?? []) item.read = false;
        await source.sync();
        expect(alpha()).toBe(0);
        clock.offset = 6 * 60 * 1000;
        await source.sync();
        expect(alpha()).toBe(3);
    });

    it("shows items marked unread elsewhere after Inoreader reflected the mark-read", async () => {
        const { source } = await connected();
        await source.sync();
        const alpha = () => source.getSnapshot().feeds.find((feed) => feed.title === "Alpha Blog")?.unreadCount;
        const page = await source.loadItems(`inoreader:${ALPHA}`, { count: 20 });
        await source.markRead(`inoreader:${ALPHA}`, page.items);
        await source.sync();
        expect(alpha()).toBe(0);
        for (const item of server.inoreader.streams.get(ALPHA)?.items ?? []) item.read = false;
        await source.sync();
        expect(alpha()).toBe(3);
    });

    it("refreshes an expired access token once", async () => {
        const { source } = await connected();
        server.inoreader.expireTokens();
        await source.sync();
        const grants = server.log
            .filter((entry) => entry.path === "/oauth2/token")
            .map((entry) => new URLSearchParams(entry.body).get("grant_type"));
        expect(grants).toEqual(["authorization_code", "refresh_token"]);
        expect(source.getSnapshot().feeds).toHaveLength(5);
    });

    it("keeps the session when the token endpoint is temporarily unavailable", async () => {
        const { source, storage } = await connected();
        server.inoreader.expireTokens();
        server.inoreader.tokenFailure = 503;
        await expect(source.sync()).rejects.toThrow("Inoreader is unavailable (HTTP 503). Try again later.");
        expect(source.getSnapshot().connected).toBe(true);
        expect(source.getSnapshot().status.phase).toBe("error");
        expect(storage.getItem("inoreader-token")).not.toBeNull();
        server.inoreader.tokenFailure = undefined;
        await source.sync();
        expect(source.getSnapshot().feeds).toHaveLength(5);
    });

    it("reuses a token another tab already refreshed", async () => {
        const { source, storage } = await connected();
        const otherTab = createSource(storage).source;
        server.inoreader.expireTokens();
        await otherTab.sync();
        await source.sync();
        const grants = server.log.filter((entry) => entry.path === "/oauth2/token");
        expect(grants).toHaveLength(2);
        expect(source.getSnapshot().feeds).toHaveLength(5);
    });

    it("marks nothing read when no item was loaded", async () => {
        const { source } = await connected();
        await source.markRead(`inoreader:${ALPHA}`, []);
        expect(server.log.some((entry) => entry.path.endsWith("/mark-all-as-read"))).toBe(false);
        expect(server.inoreader.unreadCount(ALPHA)).toBe(3);
    });

    it("disconnects when the session cannot be refreshed", async () => {
        const { source, storage } = await connected();
        server.reset({ inoreader: { subscriptions: inoreaderSubscriptions() } });
        await expect(source.sync()).rejects.toThrow();
        expect(source.getSnapshot().connected).toBe(false);
        expect(source.getSnapshot().status.phase).toBe("disconnected");
        expect(storage.getItem("inoreader-token")).toBeNull();
    });

    it("restores an irodr 1.x token", async () => {
        const { storage } = await connected();
        const saved = JSON.parse(storage.getItem("inoreader-token") ?? "{}");
        const legacy = new MemoryStorage();
        legacy.setItem(
            "inoreader-token",
            JSON.stringify({
                accessToken: saved.accessToken,
                refreshToken: saved.refreshToken,
                tokenType: "bearer",
                expires: new Date(Date.now() + 3_600_000)
            })
        );
        const { source } = createSource(legacy);
        expect(source.getSnapshot().connected).toBe(true);
        await source.sync();
        expect(source.getSnapshot().feeds).toHaveLength(5);
    });
});
