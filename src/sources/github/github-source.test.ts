import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { githubNotifications, iso } from "../../../e2e/fake-api/fixtures.ts";
import { startFakeApi } from "../../../e2e/fake-api/server.ts";
import { createMemoryStore, noWriteLock } from "../../lib/kv-store.ts";
import { GitHubApi } from "./github-api.ts";
import { githubFeedId, GitHubSource } from "./github-source.ts";

const server = await startFakeApi();
afterAll(() => server.close());
beforeEach(() => server.reset({ github: { notifications: githubNotifications(), pageSize: 2 } }));

function createSource(options: { cache?: Record<string, unknown>; credentials?: Record<string, unknown> } = {}) {
    const clock = { now: Date.now() };
    const source = new GitHubSource({
        apiBaseUrl: `${server.origin}/github`,
        webBaseUrl: "https://github.com",
        fetch: (input, init) => fetch(input, init),
        now: () => clock.now,
        cache: createMemoryStore(options.cache),
        credentials: createMemoryStore(options.credentials),
        lock: noWriteLock
    });
    return { source, advance: (ms: number) => (clock.now += ms) };
}

async function connected() {
    const setup = createSource();
    await setup.source.restore();
    await setup.source.connect("ghp_valid");
    await setup.source.sync();
    return setup;
}

const titles = (source: GitHubSource) =>
    source.getSnapshot().feeds.map((feed) => `${feed.title} (${feed.unreadCount})`);

describe("GitHubSource", () => {
    it("syncs every unread notification page and groups them by repository", async () => {
        const { source } = await connected();
        expect(titles(source)).toEqual(["acme/rocket (2)", "acme/tools (1)", "octo/docs (1)"]);
        expect(
            server
                .log()
                .filter((entry) => entry.path === "/notifications")
                .map((entry) => entry.query.page)
        ).toEqual([undefined, "2"]);
        expect(source.getSnapshot().status).toEqual({
            phase: "idle",
            message: "GitHub sync complete: 4 unread notifications."
        });
    });

    it("resolves browser URLs and bodies", async () => {
        const { source } = await connected();
        const { items } = await source.loadItems(githubFeedId("acme/rocket"));
        expect(items.map((item) => [item.title, item.url])).toEqual([
            ["v2.0.0", "https://github.com/acme/rocket/releases/tag/v2"],
            ["Launch fails on Mondays", "https://github.com/acme/rocket/issues/7"]
        ]);
        expect(items[0]?.contentHtml).toContain("<h2>Highlights</h2>");
        expect(items[0]?.contentHtml).toContain("&lt;script&gt;");
        const docs = await source.loadItems(githubFeedId("octo/docs"));
        expect(docs.items[0]?.contentHtml).toBe("<pre>Fix typo in &lt;README&gt;</pre>");
    });

    it("waits for the poll interval before syncing again", async () => {
        const { source, advance } = await connected();
        const requests = server.log().length;
        await source.sync();
        expect(server.log()).toHaveLength(requests);
        expect(source.getSnapshot().status.phase).toBe("waiting");
        advance(61_000);
        await source.sync();
        expect(server.log().length).toBeGreaterThan(requests);
    });

    it("marks a repository read through the loaded timestamp", async () => {
        const { source } = await connected();
        const { items } = await source.loadItems(githubFeedId("acme/rocket"));
        server.github.add([
            { id: "103", repository: "acme/rocket", type: "Issue", title: "Late", updated_at: iso(0.5) }
        ]);
        await source.markRead(githubFeedId("acme/rocket"), items);
        const put = server.log().find((entry) => entry.method === "PUT");
        expect(put?.path).toBe("/repos/acme/rocket/notifications");
        expect(JSON.parse(put?.body ?? "{}")).toEqual({ last_read_at: iso(1) });
        expect(server.github.unread().sort()).toEqual(["103", "201", "301"]);
        // The repository stays listed as read until reload, like a read RSS feed.
        expect(titles(source)).toEqual(["acme/rocket (0)", "acme/tools (1)", "octo/docs (1)"]);
    });

    it("keeps notifications while GitHub marks them read asynchronously (202)", async () => {
        server.github.configure({ markReadStatus: { "acme/rocket": 202 } });
        const { source } = await connected();
        const { items } = await source.loadItems(githubFeedId("acme/rocket"));
        await source.markRead(githubFeedId("acme/rocket"), items);
        expect(titles(source)[0]).toBe("acme/rocket (2)");
        expect(source.getSnapshot().status.phase).toBe("waiting");
    });

    it("keeps notifications unread when marking read fails", async () => {
        server.github.configure({ markReadStatus: { "acme/rocket": 403 } });
        const { source } = await connected();
        const { items } = await source.loadItems(githubFeedId("acme/rocket"));
        await expect(source.markRead(githubFeedId("acme/rocket"), items)).rejects.toThrow();
        expect(titles(source)[0]).toBe("acme/rocket (2)");
        expect(source.getSnapshot().status.message).toMatch(/Failed notifications remain unread\.$/);
    });

    it("removes notifications read elsewhere after a complete sync", async () => {
        const { source, advance } = await connected();
        server.github.markRead(["201"]);
        advance(61_000);
        await source.sync();
        expect(titles(source)).toEqual(["acme/rocket (2)", "acme/tools (0)", "octo/docs (1)"]);
    });

    it("backs off after a failure", async () => {
        const { source, advance } = await connected();
        server.github.configure({ notificationsStatus: 500 });
        advance(61_000);
        await expect(source.sync()).rejects.toThrow();
        expect(source.getSnapshot().status.message).toMatch(/^GitHub request failed \(HTTP 500\)/);
        const requests = server.log().length;
        await source.sync();
        expect(server.log()).toHaveLength(requests);
        // Cached notifications stay readable.
        expect(titles(source)).toHaveLength(3);
    });

    it("rejects another account for the same browser inbox", async () => {
        server.github.configure({ accounts: { ghp_valid: { id: 1, login: "a" }, ghp_other: { id: 2, login: "b" } } });
        const { source } = await connected();
        await expect(source.connect("ghp_other")).rejects.toThrow(/another GitHub account/);
        expect(source.getSnapshot().connected).toBe(false);
    });

    it("filters to releases for display only", async () => {
        const { source } = await connected();
        await source.runAction("setting:releaseOnly", { releaseOnly: true });
        expect(titles(source)).toEqual(["acme/rocket (1)"]);
        await source.runAction("setting:releaseOnly", { releaseOnly: false });
        expect(titles(source)).toEqual(["acme/rocket (2)", "acme/tools (1)", "octo/docs (1)"]);
    });

    it("restores the irodr 1.x cache and saved token", async () => {
        const { source } = createSource({
            cache: {
                snapshot: {
                    sources: [
                        {
                            id: "github-notifications",
                            adapterType: "github-notifications",
                            config: { accountId: 1, releaseOnly: false },
                            cursor: { nextPollAt: new Date(Date.now() + 60_000).toISOString() }
                        }
                    ],
                    items: [
                        {
                            externalId: "9",
                            sourceId: "github-notifications",
                            title: "Cached release",
                            updatedAt: iso(1),
                            metadata: { type: "Release", repository: "acme/cache", githubUnread: true }
                        }
                    ],
                    states: []
                }
            },
            credentials: { "credential:github-notifications": { version: 2, token: "ghp_valid" } }
        });
        await source.restore();
        expect(source.getSnapshot().connected).toBe(true);
        expect(titles(source)).toEqual(["acme/cache (1)"]);
    });

    it("stores the token only in the credential store", async () => {
        const credentials = createMemoryStore();
        const cache = createMemoryStore();
        const source = new GitHubSource({
            apiBaseUrl: `${server.origin}/github`,
            webBaseUrl: "https://github.com",
            fetch: (input, init) => fetch(input, init),
            now: () => Date.now(),
            cache,
            credentials,
            lock: noWriteLock
        });
        await source.runAction("connect", { token: "ghp_valid" });
        expect(await credentials.get("credential:github-notifications")).toEqual({ version: 2, token: "ghp_valid" });
        expect(JSON.stringify(await cache.get("snapshot"))).not.toContain("ghp_valid");
        await source.runAction("disconnect", {});
        expect(await credentials.get("credential:github-notifications")).toBeUndefined();
    });
});

describe("GitHubApi", () => {
    it("refuses pagination links to other hosts", async () => {
        const api = new GitHubApi({
            apiBaseUrl: "https://api.github.com",
            webBaseUrl: "https://github.com",
            now: () => Date.now(),
            fetch: async () =>
                new Response("[]", {
                    headers: { Link: '<https://evil.example/notifications?all=false&per_page=100&page=2>; rel="next"' }
                })
        });
        await expect(api.notificationPage(api.firstNotificationsUrl(), "token")).rejects.toThrow(
            "Invalid GitHub pagination."
        );
    });

    it("honors Retry-After when rate limited", async () => {
        const api = new GitHubApi({
            apiBaseUrl: "https://api.github.com",
            webBaseUrl: "https://github.com",
            now: () => Date.now(),
            fetch: async () => new Response("{}", { status: 429, headers: { "Retry-After": "900" } })
        });
        const error = await api
            .notificationPage(api.firstNotificationsUrl(), "token")
            .catch((reason: unknown) => reason);
        expect(error).toMatchObject({ status: 429, retryAfterMs: 900_000 });
    });
});
