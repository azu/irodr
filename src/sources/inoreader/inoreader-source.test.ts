import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { inoreaderSubscriptions } from "../../../e2e/fake-api/fixtures.ts";
import { startFakeApi } from "../../../e2e/fake-api/server.ts";
import type { Feed } from "../source.ts";
import type { StreamItemResponse, SubscriptionResponse, UnreadCountResponse } from "./api-types.ts";
import {
    createInoreaderSource,
    InoreaderRequestError,
    type InoreaderState,
    initialState,
    markReadTimestamp,
    projectFeeds,
    type SubscriptionLists,
    toItem,
    withFailure,
    withMarkedRead
} from "./inoreader-source.ts";
import { createMemoryStorage } from "./memory-storage.ts";
import { InoreaderAuthError, type WebStorage } from "./oauth.ts";

const ALPHA = "feed/https://alpha.example.com/rss";
const REDIRECT = "https://irodr.test/";

const server = await startFakeApi();
afterAll(() => server.close());
beforeEach(() => server.reset({ inoreader: { subscriptions: inoreaderSubscriptions() } }));

const clock = { offset: 0 };
beforeEach(() => {
    clock.offset = 0;
});

function createSource(setup: { storage?: WebStorage; corsProxy?: string } = {}) {
    const storage = setup.storage ?? createMemoryStorage();
    const corsProxy = setup.corsProxy ?? "";
    const navigations: string[] = [];
    const requests: string[] = [];
    const source = createInoreaderSource({
        baseUrl: `${server.origin}/inoreader`,
        corsProxy,
        redirectUri: REDIRECT,
        defaultClient: { clientId: "e2e-client", clientSecret: "e2e-secret" },
        fetch: (input, init) => {
            const url = input instanceof Request ? input.url : input.toString();
            requests.push(url);
            // Play the proxy: forward the request to the URL after the prefix.
            return fetch(url.startsWith(corsProxy) ? url.slice(corsProxy.length) : url, init);
        },
        storage,
        session: createMemoryStorage(),
        now: () => Date.now() + clock.offset,
        navigate: (url) => navigations.push(url)
    });
    return { source, storage, navigations, requests };
}

/** Follow the authorization redirect like a user clicking "Authorize". */
async function authorize(authorizeUrl: string): Promise<URL> {
    const page = await (await fetch(authorizeUrl)).text();
    const href = /id="authorize" href="([^"]+)"/.exec(page)?.[1]?.replaceAll("&#38;", "&");
    if (!href) throw new Error("No authorize link");
    return new URL(href);
}

async function connected(setup: { corsProxy?: string } = {}) {
    const created = createSource(setup);
    await created.source.runAction("connect", { clientId: "", clientSecret: "" });
    const callback = await authorize(created.navigations[0] ?? "");
    expect(await created.source.restore(callback)).toEqual({ consumedUrl: true });
    return created;
}

describe("createInoreaderSource", () => {
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
        expect(source.getSnapshot().settings.advanced?.fields.map((field) => field.value)).toEqual(["mine", "secret"]);
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

    it("sends API and token requests through the CORS proxy", async () => {
        const { source, requests, navigations } = await connected({ corsProxy: "/cors-proxy/" });
        await source.sync();
        expect(requests.map((url) => new URL(url.slice("/cors-proxy/".length)).pathname)).toEqual([
            "/inoreader/oauth2/token",
            "/inoreader/reader/api/0/subscription/list",
            "/inoreader/reader/api/0/unread-count"
        ]);
        expect(requests.every((url) => url.startsWith(`/cors-proxy/${server.origin}/inoreader/`))).toBe(true);
        // The browser opens the authorization page itself.
        expect(navigations[0]?.startsWith(`${server.origin}/inoreader/oauth2/auth?`)).toBe(true);
        expect(source.getSnapshot().feeds).toHaveLength(5);
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
        server.inoreader.markUnread(ALPHA);
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
        server.inoreader.markUnread(ALPHA);
        await source.sync();
        expect(alpha()).toBe(3);
    });

    it("refreshes an expired access token once", async () => {
        const { source } = await connected();
        server.inoreader.expireTokens();
        await source.sync();
        const grants = server
            .log()
            .filter((entry) => entry.path === "/oauth2/token")
            .map((entry) => new URLSearchParams(entry.body).get("grant_type"));
        expect(grants).toEqual(["authorization_code", "refresh_token"]);
        expect(source.getSnapshot().feeds).toHaveLength(5);
    });

    it("keeps the session when the token endpoint is temporarily unavailable", async () => {
        const { source, storage } = await connected();
        server.inoreader.expireTokens();
        server.inoreader.configure({ tokenFailure: 503 });
        await expect(source.sync()).rejects.toThrow("Inoreader is unavailable (HTTP 503). Try again later.");
        expect(source.getSnapshot().connected).toBe(true);
        expect(source.getSnapshot().status.phase).toBe("error");
        expect(storage.getItem("inoreader-token")).not.toBeNull();
        server.inoreader.configure({ tokenFailure: undefined });
        await source.sync();
        expect(source.getSnapshot().feeds).toHaveLength(5);
    });

    it("reuses a token another tab already refreshed", async () => {
        const { source, storage } = await connected();
        const otherTab = createSource({ storage }).source;
        server.inoreader.expireTokens();
        await otherTab.sync();
        await source.sync();
        const grants = server.log().filter((entry) => entry.path === "/oauth2/token");
        expect(grants).toHaveLength(2);
        expect(source.getSnapshot().feeds).toHaveLength(5);
    });

    it("marks nothing read when no item was loaded", async () => {
        const { source } = await connected();
        await source.markRead(`inoreader:${ALPHA}`, []);
        expect(server.log().some((entry) => entry.path.endsWith("/mark-all-as-read"))).toBe(false);
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
        const legacy = createMemoryStorage();
        legacy.setItem(
            "inoreader-token",
            JSON.stringify({
                accessToken: saved.accessToken,
                refreshToken: saved.refreshToken,
                tokenType: "bearer",
                expires: new Date(Date.now() + 3_600_000)
            })
        );
        const { source } = createSource({ storage: legacy });
        expect(source.getSnapshot().connected).toBe(true);
        await source.sync();
        expect(source.getSnapshot().feeds).toHaveLength(5);
    });
});

const BASE_URL = "https://www.inoreader.com";
/** A crawl time in microseconds. */
const T = 1_780_000_000_000_000;
const NOW = 1_780_000_100_000;
const A = "feed/https://a.example.com/rss";
const B = "feed/https://b.example.com/rss";

function subscription(id: string, fields: Partial<SubscriptionResponse> = {}): SubscriptionResponse {
    return {
        id,
        title: id,
        categories: [],
        url: id.replace(/^feed\//, ""),
        htmlUrl: "https://example.com/",
        iconUrl: "",
        ...fields
    };
}

function unread(id: string, count: number | string, newest: number): UnreadCountResponse {
    return { id, count, newestItemTimestampUsec: String(newest) };
}

function lists(
    subscriptions: readonly SubscriptionResponse[],
    unreadcounts: readonly UnreadCountResponse[],
    max: string | number = "1000"
): SubscriptionLists {
    return { subscriptions: { subscriptions }, unreadCounts: { max, unreadcounts } };
}

function project(state: InoreaderState, synced: SubscriptionLists, now = NOW): InoreaderState {
    return projectFeeds(state, synced, { baseUrl: BASE_URL, now });
}

function stateWith(changes: Partial<InoreaderState>): InoreaderState {
    return { ...initialState(true), ...changes };
}

describe("projectFeeds", () => {
    it("turns subscriptions and unread counts into feeds", () => {
        const withCredentials = "feed/https://user:secret@private.example.com/rss";
        const state = project(
            initialState(true),
            lists(
                [
                    subscription(A, {
                        title: "A",
                        categories: [
                            { id: "user/1/label/Blogs", label: "Blogs" },
                            { id: "user/1/label/Later", label: "Later" }
                        ],
                        htmlUrl: "https://a.example.com/"
                    }),
                    subscription(B, { iconUrl: "https://b.example.com/icon.png" }),
                    subscription(withCredentials),
                    // Inoreader returns no unread entry for some streams.
                    subscription("feed/https://missing.example.com/rss")
                ],
                [
                    unread(A, "3", T),
                    unread(B, 0, 0),
                    // The unread count endpoint drops the credentials from the stream ID.
                    unread("feed/https://private.example.com/rss", 2, T + 1)
                ],
                "250"
            )
        );
        expect(state.feeds).toEqual([
            {
                id: `inoreader:${A}`,
                sourceId: "inoreader",
                title: "A",
                category: "Blogs",
                htmlUrl: "https://a.example.com/",
                feedUrl: "https://a.example.com/rss",
                iconUrl: undefined,
                editUrl: `${BASE_URL}/feed/${encodeURIComponent("https://a.example.com/rss")}`,
                unreadCount: 3,
                unreadCountLimit: 250,
                updatedAt: Math.floor(T / 1000),
                revision: String(T)
            },
            expect.objectContaining({
                id: `inoreader:${B}`,
                category: "Uncategorized",
                iconUrl: "https://b.example.com/icon.png",
                unreadCount: 0,
                updatedAt: undefined,
                revision: "0"
            }),
            expect.objectContaining({ id: `inoreader:${withCredentials}`, unreadCount: 2, revision: String(T + 1) })
        ]);
    });

    it("makes one feed of a subscription listed twice, in its first place and category", () => {
        const state = project(
            initialState(true),
            lists(
                [
                    subscription(A, { categories: [{ id: "user/1/label/Blogs", label: "Blogs" }] }),
                    subscription(B),
                    subscription(A, { categories: [{ id: "user/1/label/Later", label: "Later" }] })
                ],
                [unread(A, 3, T), unread(B, 1, T)]
            )
        );
        expect(state.feeds.map((feed) => [feed.id, feed.category])).toEqual([
            [`inoreader:${A}`, "Blogs"],
            [`inoreader:${B}`, "Uncategorized"]
        ]);
    });

    it("counts up to 1000 when Inoreader reports no limit", () => {
        const state = project(initialState(true), lists([subscription(A)], [unread(A, 5, T)], "unknown"));
        expect(state.feeds[0]?.unreadCountLimit).toBe(1000);
    });

    it("keeps the identity of unchanged feeds", () => {
        const first = project(
            initialState(true),
            lists([subscription(A), subscription(B)], [unread(A, 3, T), unread(B, 1, T)])
        );
        const second = project(
            first,
            lists([subscription(A), subscription(B)], [unread(A, 3, T), unread(B, 2, T + 1)])
        );
        expect(second.feeds[0]).toBe(first.feeds[0]);
        expect(second.feeds[1]).not.toBe(first.feeds[1]);
        expect(second.feeds[1]?.unreadCount).toBe(2);
        expect(second.readThrough).toBe(first.readThrough);
    });

    it("shows a feed read until the unread counts reflect a mark-read", () => {
        const state = stateWith({ readThrough: new Map([[A, { through: T, at: NOW - 1000 }]]) });
        const lagging = project(state, lists([subscription(A)], [unread(A, 3, T)]));
        expect(lagging.feeds[0]?.unreadCount).toBe(0);
        expect(lagging.readThrough).toBe(state.readThrough);
        // An article that arrived after the mark-read is unread.
        const arrived = project(state, lists([subscription(A)], [unread(A, 3, T + 1)]));
        expect(arrived.feeds[0]?.unreadCount).toBe(3);
        expect(arrived.readThrough.has(A)).toBe(true);
    });

    it("drops a mark-read once Inoreader reports the feed read", () => {
        const other = "feed/https://unlisted.example.com/rss";
        const state = stateWith({
            readThrough: new Map([
                [A, { through: T, at: NOW - 1000 }],
                [other, { through: T, at: NOW - 1000 }]
            ])
        });
        const caughtUp = project(state, lists([subscription(A)], [unread(A, 0, T)]));
        expect(caughtUp.feeds[0]?.unreadCount).toBe(0);
        expect([...caughtUp.readThrough.keys()]).toEqual([other]);
        // Items marked unread elsewhere afterwards are shown.
        expect(project(caughtUp, lists([subscription(A)], [unread(A, 3, T)])).feeds[0]?.unreadCount).toBe(3);
        expect(state.readThrough.has(A)).toBe(true);
    });

    it("drops a mark-read after 5 minutes", () => {
        const state = stateWith({ readThrough: new Map([[A, { through: T, at: NOW }]]) });
        const synced = lists([subscription(A)], [unread(A, 3, T)]);
        const atLimit = project(state, synced, NOW + 5 * 60 * 1000);
        expect(atLimit.feeds[0]?.unreadCount).toBe(0);
        expect(atLimit.readThrough.has(A)).toBe(true);
        const expired = project(state, synced, NOW + 5 * 60 * 1000 + 1);
        expect(expired.feeds[0]?.unreadCount).toBe(3);
        expect(expired.readThrough.has(A)).toBe(false);
    });
});

describe("withMarkedRead", () => {
    const feeds = project(
        initialState(true),
        lists([subscription(A), subscription(B)], [unread(A, 3, T), unread(B, 2, T)])
    ).feeds;

    it("shows the feed read and records the mark-read", () => {
        const state = stateWith({ feeds });
        const next = withMarkedRead(state, A, T + 1, NOW);
        expect(next.feeds.map((feed) => feed.unreadCount)).toEqual([0, 2]);
        expect(next.feeds[1]).toBe(feeds[1]);
        expect(next.readThrough.get(A)).toEqual({ through: T + 1, at: NOW });
        // The previous state is unchanged.
        expect(state.feeds[0]?.unreadCount).toBe(3);
        expect(state.readThrough.size).toBe(0);
    });

    it("never moves the read-through timestamp back", () => {
        const state = stateWith({ feeds, readThrough: new Map([[A, { through: T + 10, at: 1 }]]) });
        expect(withMarkedRead(state, A, T, NOW).readThrough.get(A)).toEqual({ through: T + 10, at: NOW });
    });

    it("keeps a feed that already shows 0", () => {
        const read: readonly Feed[] = feeds.map((feed) => ({ ...feed, unreadCount: 0 }));
        const next = withMarkedRead(stateWith({ feeds: read }), A, T, NOW);
        expect(next.feeds[0]).toBe(read[0]);
    });
});

describe("markReadTimestamp", () => {
    it("covers the newest valid timestamp", () => {
        expect(markReadTimestamp([T - 5, T, T - 1])).toBe(T + 1);
        expect(markReadTimestamp([Number.NaN, 0, T])).toBe(T + 1);
    });

    it("is undefined without a valid timestamp", () => {
        expect(markReadTimestamp([])).toBeUndefined();
        expect(markReadTimestamp([Number.NaN, 0, -1, Number.POSITIVE_INFINITY])).toBeUndefined();
    });
});

describe("withFailure", () => {
    const feeds = project(initialState(true), lists([subscription(A)], [unread(A, 3, T)])).feeds;

    it("disconnects when the session was rejected", () => {
        const state = stateWith({ feeds });
        expect(withFailure(state, new InoreaderAuthError("Inoreader session expired. Connect again."))).toEqual({
            ...state,
            feeds: [],
            status: {
                phase: "disconnected",
                message: "Inoreader session expired. Connect again. Open Sources to connect again."
            }
        });
        expect(withFailure(state, new InoreaderRequestError("Unauthorized.", 401)).status.phase).toBe("disconnected");
    });

    it("keeps the feeds on other errors", () => {
        const state = stateWith({ feeds });
        const next = withFailure(state, new InoreaderRequestError("Inoreader request failed (HTTP 500).", 500));
        expect(next.feeds).toBe(feeds);
        expect(next.status).toEqual({ phase: "error", message: "Inoreader request failed (HTTP 500)." });
        expect(withFailure(state, "unknown").status.message).toBe("Inoreader request failed.");
    });
});

describe("toItem", () => {
    const response: StreamItemResponse = {
        id: "tag:google.com,2005:reader/item/1",
        title: "Fish &amp; Chips",
        published: 1_780_000_000,
        timestampUsec: String(T),
        categories: ["user/1/state/com.google/reading-list"],
        canonical: [{ href: "https://a.example.com/x y" }, { href: "https://a.example.com/z w" }],
        summary: { content: "<p>Body</p>" },
        author: "Author"
    };

    it("keeps the irodr 1.x article ID", () => {
        const item = toItem(`inoreader:${A}`, A, response);
        expect(item.id).toBe(
            `${A}--tag:google.com,2005:reader/item/1--https://a.example.com/xy,https://a.example.com/z w`
        );
        expect(item).toMatchObject({
            feedId: `inoreader:${A}`,
            title: "Fish & Chips",
            url: "https://a.example.com/x y",
            author: "Author",
            contentHtml: "<p>Body</p>",
            publishedAt: 1_780_000_000_000,
            updatedAt: 1_780_000_000_000,
            unread: true
        });
    });

    it("reads the read state and falls back for missing fields", () => {
        const item = toItem(`inoreader:${A}`, A, {
            id: "2",
            title: "Read",
            timestampUsec: String(T),
            categories: ["user/1/state/com.google/read"],
            alternate: [{ href: "https://a.example.com/2", type: "text/html" }]
        });
        expect(item).toMatchObject({
            id: `${A}--2--`,
            url: "https://a.example.com/2",
            author: "",
            contentHtml: "",
            publishedAt: 0,
            updatedAt: 0,
            unread: false
        });
    });

    it("shows image enclosures unless the content has images", () => {
        const enclosure = [
            { href: "https://a.example.com/a.png?x=1&y=2", type: "image/png" },
            { href: "https://a.example.com/a.mp3", type: "audio/mpeg" }
        ];
        expect(toItem(`inoreader:${A}`, A, { ...response, enclosure }).contentHtml).toBe(
            '<p>Body</p><div><img src="https://a.example.com/a.png?x=1&amp;y=2" alt="" /></div>'
        );
        const withImage = { ...response, summary: { content: '<img src="b.png">' }, enclosure };
        expect(toItem(`inoreader:${A}`, A, withImage).contentHtml).toBe('<img src="b.png">');
    });
});
