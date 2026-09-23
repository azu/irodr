import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { githubNotifications, iso } from "../../../e2e/fake-api/fixtures.ts";
import { startFakeApi } from "../../../e2e/fake-api/server.ts";
import { createMemoryStore, noWriteLock, type WriteLock } from "../../lib/kv-store.ts";
import { CONTENT_VERSION, createGitHubApi, type GitHubNotification } from "./github-api.ts";
import type { CachedItem, CachedSource, CacheSnapshot } from "./github-cache.ts";
import {
    createGitHubSource,
    githubFeedId,
    type GitHubSource,
    type GitHubState,
    INITIAL_STATE,
    projectFeeds,
    readCutoff,
    syncEntry,
    unreadDuringSync,
    withThreadsRead,
    withSyncFinished,
    withSyncStarted
} from "./github-source.ts";

const server = await startFakeApi();
afterAll(() => server.close());
beforeEach(() => server.reset({ github: { notifications: githubNotifications(), pageSize: 2 } }));

interface SourceSetup {
    cache?: Record<string, unknown>;
    credentials?: Record<string, unknown>;
    fetch?: typeof fetch;
    lock?: WriteLock;
}

function createSource(options: SourceSetup = {}) {
    const clock = { now: Date.now() };
    const cache = createMemoryStore(options.cache);
    // Every snapshot written to the cache, in order.
    const stored: CacheSnapshot[] = [];
    const source = createGitHubSource({
        apiBaseUrl: `${server.origin}/github`,
        webBaseUrl: "https://github.com",
        fetch: options.fetch ?? ((input, init) => fetch(input, init)),
        now: () => clock.now,
        cache: {
            ...cache,
            set: async (key, value) => {
                stored.push(value as CacheSnapshot);
                await cache.set(key, value);
            }
        },
        credentials: createMemoryStore(options.credentials),
        lock: options.lock ?? noWriteLock
    });
    return { source, stored, advance: (ms: number) => (clock.now += ms) };
}

async function connected(options: SourceSetup = {}) {
    const setup = createSource(options);
    await setup.source.restore();
    await setup.source.connect("ghp_valid");
    await setup.source.sync();
    return setup;
}

const titles = (source: GitHubSource) =>
    source.getSnapshot().feeds.map((feed) => `${feed.title} (${feed.unreadCount})`);

/** Once armed, `wait()` holds its callers until released. `reached` resolves when the first one waits. */
function gate() {
    const armed = { value: false };
    const reached = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    return {
        arm: () => {
            armed.value = true;
        },
        wait: async () => {
            if (!armed.value) return;
            reached.resolve();
            await released.promise;
        },
        reached: reached.promise,
        release: () => released.resolve()
    };
}

const SECOND_PAGE = /\/notifications\?.*\bpage=2\b/;

/** A fetch that, once armed, holds the responses from URLs matching `pattern` until released. */
function pausing(pattern: RegExp) {
    const held = gate();
    const pausingFetch: typeof fetch = async (input, init) => {
        const response = await fetch(input, init);
        const url = input instanceof Request ? input.url : input.toString();
        if (pattern.test(url)) await held.wait();
        return response;
    };
    return { ...held, fetch: pausingFetch };
}

/**
 * A write lock that, once armed, lets `skipped` cache writes through, then holds the next ones until released.
 * Later writes of the same tab queue behind the held one.
 */
function holdingWrites() {
    const held = gate();
    const skips = { remaining: 0 };
    const lock: WriteLock = async (_name, write) => {
        if (skips.remaining > 0) skips.remaining -= 1;
        else await held.wait();
        return write();
    };
    return {
        ...held,
        arm: (skipped: number) => {
            skips.remaining = skipped;
            held.arm();
        },
        lock
    };
}

/** Resolves once pending promise callbacks have run. */
const idle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createGitHubSource", () => {
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

    it("requests details again only for updated notifications", async () => {
        const { source, advance } = await connected();
        server.github.add([
            {
                id: "102",
                repository: "acme/rocket",
                type: "Issue",
                title: "Launch fails on Tuesdays",
                number: "7",
                updated_at: iso(0.5),
                body: "Tuesdays too."
            }
        ]);
        advance(61_000);
        const requests = server.log().length;
        await source.sync();
        const details = server
            .log()
            .slice(requests)
            .filter((entry) => entry.method === "GET" && entry.path.startsWith("/repos/"));
        expect(details.map((entry) => entry.path)).toEqual(["/repos/acme/rocket/issues/7"]);
        const { items } = await source.loadItems(githubFeedId("acme/rocket"));
        expect(items.map((item) => item.title)).toEqual(["Launch fails on Tuesdays", "v2.0.0"]);
        expect(items[0]?.contentHtml).toContain("Tuesdays too.");
        // Reused details stay.
        expect(items[1]?.contentHtml).toContain("<h2>Highlights</h2>");
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

    it("marks each notification of a repository read through the loaded timestamp", async () => {
        const { source } = await connected();
        const { items } = await source.loadItems(githubFeedId("acme/rocket"));
        server.github.add([
            { id: "103", repository: "acme/rocket", type: "Issue", title: "Late", updated_at: iso(0.5) }
        ]);
        await source.markRead(githubFeedId("acme/rocket"), items);
        const patches = server.log().filter((entry) => entry.method === "PATCH");
        expect(patches.map((entry) => entry.path).sort()).toEqual([
            "/notifications/threads/101",
            "/notifications/threads/102"
        ]);
        expect(server.log().filter((entry) => entry.method === "PUT")).toEqual([]);
        expect(server.github.unread().sort()).toEqual(["103", "201", "301"]);
        // The repository stays listed as read until reload, like a read RSS feed.
        expect(titles(source)).toEqual(["acme/rocket (0)", "acme/tools (1)", "octo/docs (1)"]);
    });

    it("marks notifications hidden by the display filter read too", async () => {
        const { source } = await connected();
        await source.runAction("setting:releaseOnly", { releaseOnly: true });
        const { items } = await source.loadItems(githubFeedId("acme/rocket"));
        expect(items.map((item) => item.title)).toEqual(["v2.0.0"]);
        await source.markRead(githubFeedId("acme/rocket"), items);
        expect(server.github.unread().sort()).toEqual(["201", "301"]);
    });

    it("keeps an update that arrived after loading unread", async () => {
        const { source, advance } = await connected();
        const { items } = await source.loadItems(githubFeedId("acme/rocket"));
        server.github.add([
            {
                id: "101",
                repository: "acme/rocket",
                type: "Release",
                title: "v2.0.1",
                number: "3",
                updated_at: iso(0.5)
            }
        ]);
        advance(61_000);
        await source.sync();
        await source.markRead(githubFeedId("acme/rocket"), items);
        const patches = server.log().filter((entry) => entry.method === "PATCH");
        expect(patches.map((entry) => entry.path)).toEqual(["/notifications/threads/102"]);
        expect(titles(source)[0]).toBe("acme/rocket (1)");
    });

    it("refuses to mark a repository read without GitHub's timestamps", async () => {
        const { source } = createSource({
            cache: {
                snapshot: {
                    sources: [
                        { id: "github-notifications", adapterType: "github-notifications", config: { accountId: 1 } }
                    ],
                    items: [
                        {
                            externalId: "9",
                            sourceId: "github-notifications",
                            title: "Cached release",
                            publishedAt: iso(1),
                            metadata: { type: "Release", repository: "acme/cache", githubUnread: true }
                        }
                    ],
                    states: []
                }
            },
            credentials: { "credential:github-notifications": { version: 2, token: "ghp_valid" } }
        });
        await source.restore();
        const { items } = await source.loadItems(githubFeedId("acme/cache"));
        expect(items.map((item) => item.updatedAt)).toEqual([Date.parse(iso(1))]);
        await expect(source.markRead(githubFeedId("acme/cache"), items)).rejects.toThrow(
            "Cannot safely mark a repository read without its notification timestamp."
        );
        expect(server.log().filter((entry) => entry.method === "PATCH")).toEqual([]);
        expect(titles(source)).toEqual(["acme/cache (1)"]);
    });

    it("keeps only the failed notifications unread", async () => {
        server.github.configure({ markReadStatus: { "102": 403 } });
        const { source } = await connected();
        const { items } = await source.loadItems(githubFeedId("acme/rocket"));
        await expect(source.markRead(githubFeedId("acme/rocket"), items)).rejects.toThrow();
        expect(server.github.unread().sort()).toEqual(["102", "201", "301"]);
        expect(titles(source)[0]).toBe("acme/rocket (1)");
        expect(source.getSnapshot().status.message).toMatch(/Failed notifications remain unread\.$/);
    });

    it("treats a notification already read on GitHub (304) as read", async () => {
        const { source } = await connected();
        const { items } = await source.loadItems(githubFeedId("acme/rocket"));
        server.github.markRead(["101"]);
        await source.markRead(githubFeedId("acme/rocket"), items);
        expect(titles(source)[0]).toBe("acme/rocket (0)");
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

    it("does not bring back notifications marked read during a sync", async () => {
        const pause = pausing(SECOND_PAGE);
        const { source, advance } = await connected({ fetch: pause.fetch });
        const { items } = await source.loadItems(githubFeedId("acme/rocket"));
        advance(61_000);
        pause.arm();
        const syncing = source.sync();
        // Every page, including the acme/rocket notifications, is loaded before they are marked read.
        await pause.reached;
        await source.markRead(githubFeedId("acme/rocket"), items);
        pause.release();
        await syncing;
        expect(titles(source)).toEqual(["acme/rocket (0)", "acme/tools (1)", "octo/docs (1)"]);
    });

    it("does not bring back a notification marked read while its details load", async () => {
        const pause = pausing(/\/repos\/acme\/rocket\/issues\/7$/);
        const { source, advance } = await connected({ fetch: pause.fetch });
        server.github.add([
            {
                id: "102",
                repository: "acme/rocket",
                type: "Issue",
                title: "Launch fails on Tuesdays",
                number: "7",
                updated_at: iso(0.5),
                body: "Tuesdays too."
            }
        ]);
        advance(61_000);
        pause.arm();
        const syncing = source.sync();
        // The inbox is written; the details of the updated notification are on their way.
        await pause.reached;
        const { items } = await source.loadItems(githubFeedId("acme/rocket"));
        expect(items.map((item) => item.title)).toEqual(["Launch fails on Tuesdays", "v2.0.0"]);
        await source.markRead(githubFeedId("acme/rocket"), items);
        expect(titles(source)).toEqual(["acme/rocket (0)", "acme/tools (1)", "octo/docs (1)"]);
        pause.release();
        await syncing;
        // The details checkpoint, the last write of the sync, leaves the repository read.
        expect(titles(source)).toEqual(["acme/rocket (0)", "acme/tools (1)", "octo/docs (1)"]);
        expect(source.getSnapshot().status.message).toBe("GitHub sync complete: 2 unread notifications.");
    });

    // The sync's writes, in order: the page (a single one here), the inbox, then the details of 103.
    it.each([
        // 103 is read with the others only when it was stored before they were marked read.
        { write: "page", skipped: 0, unread: ["103", "201", "301"], rocket: "acme/rocket (1)" },
        { write: "inbox", skipped: 1, unread: ["201", "301"], rocket: "acme/rocket (0)" }
    ])(
        "filters the queued $write write with the notifications read while it waited",
        async ({ skipped, unread, rocket }) => {
            server.github.configure({ pageSize: 100 });
            const patch = pausing(/\/notifications\/threads\/\w+$/);
            const writes = holdingWrites();
            const { source, advance, stored } = await connected({ fetch: patch.fetch, lock: writes.lock });
            const { items } = await source.loadItems(githubFeedId("acme/rocket"));
            // Marked unread again on GitHub after the repository was loaded, older than the loaded notifications.
            server.github.add([
                { id: "103", repository: "acme/rocket", type: "Issue", title: "Reopened", updated_at: iso(1.5) }
            ]);
            advance(61_000);
            writes.arm(skipped);
            patch.arm();
            const syncing = source.sync();
            // A write with 101 and 102 waits in the queue while they are marked read.
            await writes.reached;
            const written = stored.length;
            const marking = source.markRead(githubFeedId("acme/rocket"), items);
            await patch.reached;
            patch.release();
            // GitHub answered: the reads are recorded, and their own write queues behind the held one.
            await idle();
            writes.release();
            await Promise.all([marking, syncing]);
            // Once 101 and 102 are removed, no later write of the sync stores them again.
            const stale = stored
                .slice(written)
                .map((snapshot) =>
                    snapshot.items.some((item) => item.externalId === "101" || item.externalId === "102")
                );
            expect(stale.at(-1)).toBe(false);
            expect(stale.slice(stale.indexOf(false))).not.toContain(true);
            expect(server.github.unread().sort()).toEqual(unread);
            expect(titles(source)).toEqual([rocket, "acme/tools (1)", "octo/docs (1)"]);
        }
    );

    it("shares a running sync between callers", async () => {
        const { source, advance } = await connected();
        advance(61_000);
        const requests = server.log().length;
        const first = source.sync();
        expect(source.sync()).toBe(first);
        await first;
        const pages = server
            .log()
            .slice(requests)
            .filter((entry) => entry.path === "/notifications");
        expect(pages).toHaveLength(2);
    });

    it("cancels a running sync on disconnect", async () => {
        const pause = pausing(SECOND_PAGE);
        const { source, advance } = await connected({ fetch: pause.fetch });
        advance(61_000);
        pause.arm();
        const syncing = source.sync();
        await pause.reached;
        const requests = server.log().length;
        await source.runAction("disconnect", {});
        pause.release();
        await expect(syncing).resolves.toBeUndefined();
        expect(server.log()).toHaveLength(requests);
        expect(source.getSnapshot()).toMatchObject({ connected: false, status: { phase: "disconnected" } });
        // The cached inbox stays readable.
        expect(titles(source)).toEqual(["acme/rocket (2)", "acme/tools (1)", "octo/docs (1)"]);
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
        const source = createGitHubSource({
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

const WEB = "https://github.com";
const cachedItem = (externalId: string, repository: string, overrides: Partial<CachedItem> = {}): CachedItem => ({
    externalId,
    sourceId: "github-notifications",
    title: `Notification ${externalId}`,
    updatedAt: iso(Number(externalId)),
    metadata: { type: "Issue", repository, githubUnread: true },
    ...overrides
});
const cacheSnapshot = (
    items: readonly CachedItem[],
    config: CachedSource["config"] = { accountId: 1 }
): CacheSnapshot => ({
    sources: [{ id: "github-notifications", adapterType: "github-notifications", config }],
    items,
    states: []
});
const feedTitles = (state: GitHubState) => state.feeds.map((feed) => `${feed.title} (${feed.unreadCount})`);

describe("GitHub source state", () => {
    it("lists repositories in first-seen order and keeps read ones until reload", () => {
        const first = projectFeeds(
            INITIAL_STATE,
            cacheSnapshot([
                cachedItem("3", "acme/rocket"),
                cachedItem("2", "octo/docs"),
                cachedItem("1", "acme/rocket")
            ]),
            WEB
        );
        expect(feedTitles(first)).toEqual(["acme/rocket (2)", "octo/docs (1)"]);
        // Newest first.
        expect(first.items.get(githubFeedId("acme/rocket"))?.map((item) => item.title)).toEqual([
            "Notification 1",
            "Notification 3"
        ]);
        const second = projectFeeds(
            first,
            cacheSnapshot([cachedItem("4", "acme/tools"), cachedItem("2", "octo/docs")]),
            WEB
        );
        expect(feedTitles(second)).toEqual(["acme/rocket (0)", "octo/docs (1)", "acme/tools (1)"]);
        // Unchanged feeds and items stay the same objects.
        expect(second.feeds[1]).toBe(first.feeds[1]);
        expect(second.items.get(githubFeedId("octo/docs"))).toEqual(first.items.get(githubFeedId("octo/docs")));
        expect(second.items.get(githubFeedId("octo/docs"))?.[0]).toBe(first.items.get(githubFeedId("octo/docs"))?.[0]);
        expect(first.feeds.map((feed) => feed.title)).toEqual(["acme/rocket", "octo/docs"]);
    });

    it("skips read, foreign and malformed notifications", () => {
        const state = projectFeeds(
            INITIAL_STATE,
            cacheSnapshot([
                cachedItem("1", "acme/rocket", { metadata: { repository: "acme/rocket", githubUnread: false } }),
                cachedItem("2", "acme/rocket", { sourceId: "other" }),
                cachedItem("3", "../rocket"),
                cachedItem("4", "octo/docs")
            ]),
            WEB
        );
        expect(feedTitles(state)).toEqual(["octo/docs (1)"]);
        expect(state.feeds[0]).toMatchObject({
            id: githubFeedId("octo/docs"),
            sourceId: "github-notifications",
            category: "GitHub Notifications",
            htmlUrl: "https://github.com/octo/docs"
        });
    });

    it("shows only repositories with releases in the release-only display", () => {
        const state = projectFeeds(
            INITIAL_STATE,
            cacheSnapshot(
                [
                    cachedItem("1", "acme/rocket", { metadata: { type: "Release", repository: "acme/rocket" } }),
                    cachedItem("2", "acme/rocket"),
                    cachedItem("3", "octo/docs")
                ],
                { accountId: 1, releaseOnly: true }
            ),
            WEB
        );
        expect(feedTitles(state)).toEqual(["acme/rocket (1)"]);
        expect([...state.repositories]).toEqual(["acme/rocket", "octo/docs"]);
    });

    it("has no feeds without a connected account", () => {
        const state = projectFeeds(
            projectFeeds(INITIAL_STATE, cacheSnapshot([cachedItem("1", "acme/rocket")]), WEB),
            { sources: [], items: [cachedItem("1", "acme/rocket")], states: [] },
            WEB
        );
        expect(state.feeds).toEqual([]);
        expect(state.items.size).toBe(0);
    });

    it("filters the writes of a running sync with the notifications read since it started", () => {
        const items = [
            cachedItem("1", "acme/rocket"),
            cachedItem("3", "acme/rocket"),
            cachedItem("2", "octo/docs"),
            // Updated after it was read.
            cachedItem("4", "acme/rocket", { updatedAt: iso(0.5) })
        ];
        const read3 = new Map([
            ["3", Date.parse(iso(3))],
            ["4", Date.parse(iso(4))]
        ]);
        const running = withSyncStarted(withSyncStarted(INITIAL_STATE, 1), 2);
        const read = withThreadsRead(withThreadsRead(running, read3), new Map([["3", 0]]));
        expect(read.readsDuringSync.get(1)).toEqual(read3);
        expect(unreadDuringSync(read, 2, items).map((item) => item.externalId)).toEqual(["1", "2", "4"]);
        const finished = withSyncFinished(read, 1);
        expect([...finished.readsDuringSync.keys()]).toEqual([2]);
        // A sync started later ignores earlier reads, and no reads are recorded without a running sync.
        expect(withSyncStarted(finished, 3).readsDuringSync.get(3)).toEqual(new Map());
        expect(withThreadsRead(INITIAL_STATE, read3).readsDuringSync.size).toBe(0);
        expect(INITIAL_STATE.readsDuringSync.size).toBe(0);
    });

    it("reuses cached details only for the same type, update and content version", () => {
        const notification: GitHubNotification = {
            id: "7",
            unread: true,
            updated_at: iso(1),
            subject: { title: "Launch fails", type: "Issue", url: "https://api.github.com/repos/acme/rocket/issues/7" },
            repository: { full_name: "acme/rocket" }
        };
        const resolved = cachedItem("7", "acme/rocket", {
            title: "Old title",
            url: "https://github.com/acme/rocket/issues/7",
            content: "<p>Body</p>",
            publishedAt: iso(5),
            updatedAt: iso(1),
            metadata: {
                type: "Issue",
                repository: "acme/rocket",
                githubUnread: true,
                detailsResolved: true,
                contentVersion: CONTENT_VERSION
            }
        });
        const reused = syncEntry(notification, resolved, WEB);
        expect(reused.reusable).toBe(true);
        expect(reused.notification).toBe(notification);
        expect(reused.item).toEqual({
            externalId: "7",
            sourceId: "github-notifications",
            title: "Launch fails",
            url: "https://github.com/acme/rocket/issues/7",
            content: "<p>Body</p>",
            publishedAt: iso(5),
            updatedAt: iso(1),
            metadata: {
                type: "Issue",
                repository: "acme/rocket",
                githubUnread: true,
                contentVersion: CONTENT_VERSION,
                detailsResolved: true
            }
        });
        // Details resolved by irodr 1.x are marked `releaseResolved`.
        const legacy = {
            ...resolved,
            metadata: { type: "Issue", releaseResolved: true, contentVersion: CONTENT_VERSION }
        };
        expect(syncEntry(notification, legacy, WEB).reusable).toBe(true);
        const stale = [
            syncEntry({ ...notification, updated_at: iso(0.5) }, resolved, WEB),
            syncEntry({ ...notification, subject: { ...notification.subject, type: "PullRequest" } }, resolved, WEB),
            syncEntry(
                notification,
                { ...resolved, metadata: { ...resolved.metadata, contentVersion: CONTENT_VERSION - 1 } },
                WEB
            ),
            syncEntry(notification, { ...resolved, metadata: { ...resolved.metadata, detailsResolved: false } }, WEB),
            syncEntry({ ...notification, updated_at: undefined }, { ...resolved, updatedAt: undefined }, WEB)
        ];
        expect(stale.map((entry) => entry.reusable)).toEqual([false, false, false, false, false]);
        // Cached details stay visible until refreshed details arrive.
        for (const entry of stale) {
            expect(entry.item).toMatchObject({
                title: "Launch fails",
                url: "https://github.com/acme/rocket/issues/7",
                content: "<p>Body</p>",
                publishedAt: iso(5),
                metadata: { detailsResolved: false }
            });
        }
        expect(stale.map((entry) => entry.item.updatedAt)).toEqual([iso(0.5), iso(1), iso(1), iso(1), undefined]);
        expect(stale[1]?.item.metadata?.type).toBe("PullRequest");
        // Without a cached item, the repository page is the URL until details arrive.
        expect(syncEntry(notification, undefined, WEB)).toEqual({
            notification,
            reusable: false,
            item: {
                externalId: "7",
                sourceId: "github-notifications",
                title: "Launch fails",
                url: "https://github.com/acme/rocket",
                updatedAt: iso(1),
                metadata: { type: "Issue", repository: "acme/rocket", githubUnread: true }
            }
        });
    });

    it("marks read through the newest loaded notification with GitHub's timestamp", () => {
        const snapshot = cacheSnapshot([
            cachedItem("1", "acme/rocket"),
            cachedItem("2", "acme/rocket"),
            cachedItem("3", "acme/rocket", { updatedAt: undefined, publishedAt: iso(0.5) })
        ]);
        const loaded = projectFeeds(INITIAL_STATE, snapshot, WEB).items.get(githubFeedId("acme/rocket")) ?? [];
        expect(loaded.map((item) => item.title)).toEqual(["Notification 3", "Notification 1", "Notification 2"]);
        // Not the publish-date fallback of notification 3.
        expect(readCutoff(snapshot, loaded)).toBe(Date.parse(iso(1)));
        expect(readCutoff(snapshot, loaded.slice(2))).toBe(Date.parse(iso(2)));
        // An update cached after loading stays unread.
        const updated = cacheSnapshot([cachedItem("1", "acme/rocket", { updatedAt: iso(0.25) })]);
        expect(readCutoff(updated, loaded)).toBe(Date.parse(iso(1)));
        // None of them is cached any more: they were read in another browser.
        expect(readCutoff(cacheSnapshot([]), loaded)).toBeUndefined();
        expect(
            readCutoff(cacheSnapshot([cachedItem("1", "acme/rocket", { sourceId: "other" })]), loaded)
        ).toBeUndefined();
        // No safe timestamp.
        expect(readCutoff(snapshot, loaded.slice(0, 1))).toBe(-Infinity);
    });
});

describe("createGitHubApi", () => {
    it("refuses pagination links to other hosts", async () => {
        const api = createGitHubApi({
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
        const api = createGitHubApi({
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
