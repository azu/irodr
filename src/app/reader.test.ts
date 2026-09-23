import { describe, expect, it } from "vite-plus/test";
import { createStore } from "../lib/store.ts";
import type { Feed, Item, Source, SourceCapabilities, SourceSnapshot, SourceStatus } from "../sources/source.ts";
import { DEFAULT_PREFERENCES } from "./preferences.ts";
import { createReader } from "./reader.ts";

interface MemorySourceConfig {
    readonly failLoad: ReadonlySet<string>;
    readonly failMarkRead: ReadonlySet<string>;
    /** The status a failing mark-read request leaves, e.g. an expired login. */
    readonly markReadStatus?: SourceStatus;
    /** Loads wait for this promise, to simulate a slow network. */
    readonly gate: Promise<void>;
    /** Marking a feed read removes its items, as GitHub Notifications returns unread notifications only. */
    readonly forgetRead?: boolean;
}

/** An in-memory Source that records what the reader asks for. */
interface MemorySource extends Source {
    /** Change how the source behaves from now on. */
    configure: (patch: Partial<MemorySourceConfig>) => void;
    setFeed: (title: string, items: readonly { title: string; unread?: boolean }[], category?: string) => Feed;
    removeFeed: (id: string) => void;
    /** List a feed a second time, right after itself, as Inoreader did for a duplicated subscription. */
    duplicateFeed: (id: string) => void;
    setStatus: (status: SourceStatus) => void;
    /** Mark-read requests, oldest first, with the titles of the items they were given. */
    marked: () => readonly { readonly feedId: string; readonly items: readonly string[] }[];
    /** Item loads, oldest first. */
    loads: () => readonly { readonly feedId: string; readonly continuation?: string }[];
}

interface MemoryRecords {
    readonly config: MemorySourceConfig;
    readonly items: ReadonlyMap<string, readonly Item[]>;
    readonly marked: ReturnType<MemorySource["marked"]>;
    readonly loads: ReturnType<MemorySource["loads"]>;
}

function createMemorySource(id: string, capabilities: Partial<SourceCapabilities> = {}): MemorySource {
    const snapshot = createStore<SourceSnapshot>({
        connected: true,
        status: { phase: "idle", message: "" },
        feeds: [],
        settings: { description: [], fields: [], actions: [] }
    });
    // Kept apart from the snapshot, so recording a request does not notify the reader.
    const records = createStore<MemoryRecords>({
        config: { failLoad: new Set(), failMarkRead: new Set(), gate: Promise.resolve() },
        items: new Map(),
        marked: [],
        loads: []
    });

    return {
        id,
        title: id,
        capabilities: { loadMore: true, unreadFilter: true, liveItems: false, ...capabilities },
        getSnapshot: snapshot.get,
        subscribe: snapshot.subscribe,
        configure: (patch) => records.update((current) => ({ ...current, config: { ...current.config, ...patch } })),
        setFeed: (title, items, category = "News") => {
            const feedId = `${id}:${title}`;
            const feed: Feed = {
                id: feedId,
                sourceId: id,
                title,
                category,
                htmlUrl: `https://example.com/${title}`,
                unreadCount: items.filter((item) => item.unread !== false).length,
                revision: items.map((item) => item.title).join()
            };
            const loaded = items.map((item, index): Item => ({
                id: `${feedId}/${item.title}`,
                feedId,
                title: item.title,
                url: `https://example.com/${item.title}`,
                author: "",
                contentHtml: "",
                publishedAt: 1000 - index,
                updatedAt: 1000 - index,
                unread: item.unread !== false
            }));
            records.update((current) => ({ ...current, items: new Map([...current.items, [feedId, loaded]]) }));
            snapshot.update((current) => ({
                ...current,
                feeds: [...current.feeds.filter((candidate) => candidate.id !== feedId), feed]
            }));
            return feed;
        },
        removeFeed: (feedId) =>
            snapshot.update((current) => ({ ...current, feeds: current.feeds.filter((feed) => feed.id !== feedId) })),
        duplicateFeed: (feedId) =>
            snapshot.update((current) => ({
                ...current,
                feeds: current.feeds.flatMap((feed) => (feed.id === feedId ? [feed, { ...feed }] : [feed]))
            })),
        setStatus: (status) => snapshot.update((current) => ({ ...current, status })),
        marked: () => records.get().marked,
        loads: () => records.get().loads,
        restore: async () => ({ consumedUrl: false }),
        sync: async () => undefined,
        loadItems: async (feedId, options) => {
            records.update((current) => ({
                ...current,
                loads: [...current.loads, { feedId, continuation: options.continuation }]
            }));
            await records.get().config.gate;
            if (records.get().config.failLoad.has(feedId)) throw new Error("load failed");
            const items = records.get().items.get(feedId) ?? [];
            const offset = Number(options.continuation ?? 0);
            const page = items.slice(offset, offset + options.count);
            return {
                items: page,
                continuation: offset + options.count < items.length ? String(offset + options.count) : undefined
            };
        },
        markRead: async (feedId, loadedItems) => {
            records.update((current) => ({
                ...current,
                marked: [...current.marked, { feedId, items: loadedItems.map((item) => item.title) }]
            }));
            const { failMarkRead, markReadStatus, forgetRead } = records.get().config;
            if (failMarkRead.has(feedId)) {
                if (markReadStatus) snapshot.update((current) => ({ ...current, status: markReadStatus }));
                throw new Error("mark failed");
            }
            if (forgetRead) {
                records.update((current) => ({ ...current, items: new Map([...current.items, [feedId, []]]) }));
            }
            if (snapshot.get().feeds.some((candidate) => candidate.id === feedId)) {
                snapshot.update((current) => ({
                    ...current,
                    feeds: current.feeds.map((candidate) =>
                        candidate.id === feedId
                            ? { ...candidate, unreadCount: 0, revision: forgetRead ? "" : candidate.revision }
                            : candidate
                    )
                }));
            }
        },
        runAction: async () => "done"
    };
}

async function setup(options: { prefetch?: number; fetch?: number; capabilities?: Partial<SourceCapabilities> } = {}) {
    const source = createMemorySource("memory", options.capabilities);
    source.setFeed("A", [{ title: "a1" }, { title: "a2" }]);
    source.setFeed("B", [{ title: "b1" }, { title: "b2", unread: false }, { title: "b3", unread: false }]);
    source.setFeed("C", [{ title: "c1" }]);
    source.setFeed("Read", [{ title: "r1", unread: false }]);
    source.setFeed("D", [{ title: "d1" }], "Blogs");
    const reader = createReader({
        sources: [source],
        preferences: {
            ...DEFAULT_PREFERENCES,
            prefetchSubscriptionCount: options.prefetch ?? 0,
            fetchContentsCount: options.fetch ?? 20
        }
    });
    await reader.start(new URL("https://irodr.test/"));
    const current = () => reader.getState().list.currentFeedId?.split(":")[1];
    const titles = () => reader.getState().view?.items.map((item) => item.title);
    const listed = () =>
        reader
            .getState()
            .list.categories.flatMap((category) => category.feeds.map((feed) => `${feed.title}(${feed.unreadCount})`));
    return { source, reader, current, titles, listed };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Reader", () => {
    it("lists unread feeds by category name and hides read ones", async () => {
        const { reader, listed } = await setup();
        expect(reader.getState().list.categories.map((category) => category.name)).toEqual(["Blogs", "News"]);
        expect(listed()).toEqual(["D(1)", "A(2)", "B(1)", "C(1)"]);
        expect(reader.getState().totals).toEqual({ unread: 5, feeds: 5 });
    });

    it("s opens feeds in order and marks the departed feed read with the items the reader saw", async () => {
        const { reader, source, current, titles, listed } = await setup();
        await reader.nextFeed();
        expect(current()).toBe("D");
        await reader.nextFeed();
        expect(current()).toBe("A");
        expect(titles()).toEqual(["a1", "a2"]);
        await settle();
        expect(source.marked()).toEqual([{ feedId: "memory:D", items: ["d1"] }]);
        // D stays listed while it is in the recent history.
        expect(listed()).toEqual(["D(0)", "A(2)", "B(1)", "C(1)"]);
    });

    it("shows the items it marked read while the feed stays listed, though the source drops them", async () => {
        const { reader, source, current, titles, listed } = await setup({
            capabilities: { unreadFilter: false, liveItems: true }
        });
        source.configure({ forgetRead: true });
        await reader.openFeed("memory:A");
        await reader.nextFeed();
        expect(current()).toBe("B");
        await settle();
        expect(listed()).toEqual(["D(1)", "A(0)", "B(1)", "C(1)"]);
        await reader.prevFeed();
        expect(current()).toBe("A");
        expect(reader.getState().view?.items.map((item) => [item.title, item.unread])).toEqual([
            ["a1", false],
            ["a2", false]
        ]);
        // m keeps the open feed readable too.
        await reader.nextFeed();
        await reader.markCurrentFeedRead();
        await settle();
        expect(current()).toBe("B");
        expect(titles()).toEqual(["b1", "b2", "b3"]);
    });

    it("forgets the items it marked read once the feed leaves the list", async () => {
        const { reader, source, titles } = await setup({ capabilities: { unreadFilter: false, liveItems: true } });
        source.configure({ forgetRead: true });
        await reader.openFeed("memory:A");
        await reader.openFeed("memory:B");
        await settle();
        // Visit other feeds until A is no longer among the recently visited ones.
        for (const feedId of ["memory:C", "memory:D", "memory:B", "memory:C", "memory:D"]) {
            await reader.openFeed(feedId);
        }
        await settle();
        expect(reader.getState().list.navigation).not.toContain("memory:A");
        await reader.openFeed("memory:A");
        expect(titles()).toEqual([]);
    });

    it("reselecting the current feed is not navigation", async () => {
        const { reader, source } = await setup();
        await reader.openFeed("memory:A");
        await reader.openFeed("memory:A");
        await settle();
        expect(source.marked()).toEqual([]);
    });

    it("Shift+S skips without marking read, and forgets the skipped feed in the history", async () => {
        const { reader, source, current } = await setup();
        await reader.openFeed("memory:A");
        await reader.skipFeed();
        expect(current()).toBe("B");
        await reader.nextFeed();
        expect(current()).toBe("C");
        await settle();
        expect(source.marked().map((entry) => entry.feedId)).toEqual(["memory:B"]);
        // `a` follows the list order.
        await reader.prevFeed();
        expect(current()).toBe("B");
    });

    it("keeps a feed unread when marking it read fails", async () => {
        const { reader, source, listed } = await setup();
        source.configure({ failMarkRead: new Set(["memory:A"]) });
        await reader.openFeed("memory:A");
        await reader.nextFeed();
        await settle();
        expect(listed()).toContain("A(2)");
        expect(reader.getState().message.text).toBe("Could not mark A as read. mark failed");
    });

    it("shows unread items by default and all items with the filter off", async () => {
        const { reader, titles } = await setup();
        await reader.openFeed("memory:B");
        expect(titles()).toEqual(["b1"]);
        reader.toggleFilter();
        expect(titles()).toEqual(["b1", "b2", "b3"]);
        // The filter resets when opening another feed.
        await reader.openFeed("memory:A");
        await reader.openFeed("memory:B");
        expect(reader.getState().view?.filterEnabled).toBe(true);
    });

    it("loads older items with the continuation", async () => {
        const { reader, source, titles } = await setup({ fetch: 1 });
        await reader.openFeed("memory:B");
        expect(titles()).toEqual(["b1"]);
        await reader.loadMore();
        expect(titles()).toEqual(["b1", "b2"]);
        await reader.loadMore();
        expect(titles()).toEqual(["b1", "b2", "b3"]);
        expect(reader.getState().view?.canLoadMore).toBe(false);
        expect(
            source
                .loads()
                .filter((load) => load.feedId === "memory:B")
                .map((load) => load.continuation)
        ).toEqual([undefined, "1", "2"]);
    });

    it("does not offer the unread filter or load more when the source cannot", async () => {
        const { reader } = await setup({ capabilities: { loadMore: false, unreadFilter: false } });
        await reader.openFeed("memory:B");
        expect(reader.getState().view?.items).toHaveLength(3);
        reader.toggleFilter();
        expect(reader.getState().view?.filterEnabled).toBe(false);
        expect(reader.getState().view?.canLoadMore).toBe(false);
    });

    it("prefetches the following feeds, which then open without loading", async () => {
        const { reader, source } = await setup({ prefetch: 2 });
        await reader.openFeed("memory:D");
        await settle();
        await settle();
        expect(source.loads().map((load) => load.feedId)).toEqual(["memory:D", "memory:A", "memory:B"]);
        expect(reader.getState().list.prefetched).toEqual(new Set(["memory:D", "memory:A", "memory:B"]));
        await reader.nextFeed();
        expect(source.loads().filter((load) => load.feedId === "memory:A")).toHaveLength(1);
    });

    it("only the latest navigation takes effect", async () => {
        const { reader, current } = await setup();
        const first = reader.openFeed("memory:A");
        const second = reader.openFeed("memory:C");
        expect(await first).toBe("superseded");
        expect(await second).toBe("opened");
        expect(current()).toBe("C");
    });

    it("repeated s while a feed loads moves on from the loading feed", async () => {
        const { reader, source, current } = await setup();
        const { promise, resolve: release } = Promise.withResolvers<void>();
        source.configure({ gate: promise });
        const presses = [reader.nextFeed(), reader.nextFeed(), reader.nextFeed()];
        expect(reader.getState().list.loadingFeedId).toBe("memory:B");
        release();
        await Promise.all(presses);
        expect(current()).toBe("B");
        expect(reader.getState().list.loadingFeedId).toBeUndefined();
        await settle();
        // Feeds passed over while loading were never shown, so they stay unread.
        expect(source.marked()).toEqual([]);
    });

    it("keeps newer items when an older load finishes last", async () => {
        const { reader, source, titles } = await setup();
        const slow = Promise.withResolvers<void>();
        source.configure({ gate: slow.promise });
        const first = reader.openFeed("memory:A");
        // The feed changes while the first load is in flight; opening it again loads the new revision.
        source.setFeed("A", [{ title: "a0" }, { title: "a1" }, { title: "a2" }]);
        source.configure({ gate: Promise.resolve() });
        expect(await reader.openFeed("memory:A")).toBe("opened");
        slow.resolve();
        expect(await first).toBe("superseded");
        expect(titles()).toEqual(["a0", "a1", "a2"]);
    });

    it("skips feeds that fail to load", async () => {
        const { reader, source, current } = await setup();
        source.configure({ failLoad: new Set(["memory:A"]) });
        await reader.openFeed("memory:D");
        await reader.nextFeed();
        expect(current()).toBe("B");
        await settle();
        // The failed feed was never shown, so it is not marked read.
        expect(source.marked().map((entry) => entry.feedId)).toEqual(["memory:D"]);
    });

    it("keeps the current feed listed when its source drops it", async () => {
        const { reader, source, listed } = await setup();
        await reader.openFeed("memory:C");
        source.removeFeed("memory:C");
        expect(listed()).toContain("C(0)");
        // The view shows the same feed as the list, with nothing unread.
        const { view, list } = reader.getState();
        expect(view?.feed.unreadCount).toBe(0);
        expect(list.categories.flatMap((category) => category.feeds)).toContain(view?.feed);
        await reader.prevFeed();
        expect(listed()).not.toContain("C(0)");
    });

    it("lists a feed its source reports twice once, so s moves past it", async () => {
        const { reader, source, current, listed } = await setup();
        source.duplicateFeed("memory:A");
        expect(listed().filter((title) => title.startsWith("A("))).toHaveLength(1);
        await reader.openFeed("memory:A");
        await reader.nextFeed();
        expect(current()).toBe("B");
    });

    it("z collapses every category, then expands them", async () => {
        const { reader } = await setup();
        reader.toggleAllCategories();
        expect(reader.getState().list.categories.every((category) => category.collapsed)).toBe(true);
        // Navigation still includes collapsed categories.
        expect(reader.getState().list.navigation).toHaveLength(4);
        reader.toggleAllCategories();
        expect(reader.getState().list.categories.some((category) => category.collapsed)).toBe(false);
    });

    it("focus moves between items", async () => {
        const { reader } = await setup();
        await reader.openFeed("memory:A");
        reader.focusItem("memory:A/a1");
        expect(reader.adjacentItem(1)?.title).toBe("a2");
        reader.scrollToItem("memory:A/a2");
        expect(reader.getState().focusItemId).toBe("memory:A/a2");
        expect(reader.adjacentItem(1)).toBeUndefined();
        expect(reader.adjacentItem(-1)?.title).toBe("a1");
    });

    it("shows the source's error when the failed mark-read request caused it", async () => {
        const { reader, source } = await setup();
        source.configure({
            failMarkRead: new Set(["memory:A"]),
            markReadStatus: { phase: "error", message: "Login expired" }
        });
        await reader.openFeed("memory:A");
        await reader.nextFeed();
        await settle();
        expect(reader.getState().message).toMatchObject({ text: "Login expired", error: true });
    });

    it("explains a failed mark-read itself when the source's error was already there", async () => {
        const { reader, source } = await setup();
        await settle();
        source.setStatus({ phase: "error", message: "Rate limited" });
        source.configure({ failMarkRead: new Set(["memory:A"]) });
        await reader.openFeed("memory:A");
        await reader.nextFeed();
        await settle();
        expect(reader.getState().message).toMatchObject({ text: "Could not mark A as read. mark failed", error: true });
    });

    it("reports a source error once, when it first appears", async () => {
        const { reader, source } = await setup();
        await settle();
        source.setStatus({ phase: "error", message: "Rate limited" });
        expect(reader.getState().message).toMatchObject({ text: "Rate limited", error: true });
        reader.setMessage("Another error", { error: true });
        source.setFeed("E", [{ title: "e1" }]);
        expect(reader.getState().message.text).toBe("Another error");
        // Once cleared, the error is reported again when it comes back.
        source.setStatus({ phase: "idle", message: "" });
        source.setStatus({ phase: "error", message: "Rate limited" });
        expect(reader.getState().message.text).toBe("Rate limited");
    });

    it("reports feeds that fail to prefetch", async () => {
        const { reader, source } = await setup({ prefetch: 2 });
        await settle();
        source.configure({ failLoad: new Set(["memory:A"]) });
        await reader.openFeed("memory:D");
        await settle();
        expect(reader.getState().message).toMatchObject({ text: "Could not prefetch the next feeds.", error: true });
        expect(reader.getState().list.prefetched).toEqual(new Set(["memory:D", "memory:B"]));
    });

    it("shares one refresh between overlapping calls", async () => {
        const { reader } = await setup();
        await settle();
        const first = reader.refresh();
        expect(reader.refresh()).toBe(first);
        await first;
        expect(reader.refresh()).not.toBe(first);
    });

    it("reschedules the auto refresh when preferences change", async () => {
        const timers: string[] = [];
        const reader = createReader({
            sources: [],
            setInterval: (_task, ms) => {
                timers.push(`start ${ms}`);
                return () => timers.push(`stop ${ms}`);
            }
        });
        await reader.start(new URL("https://irodr.test/"));
        expect(timers).toEqual(["start 120000"]);
        reader.updatePreferences({ autoRefreshSubscriptionSec: 60 });
        expect(timers).toEqual(["start 120000", "stop 120000", "start 60000"]);
        reader.updatePreferences({ enableAutoRefreshSubscription: false });
        expect(timers).toEqual(["start 120000", "stop 120000", "start 60000", "stop 60000"]);
        // Re-enabling keeps the interval set earlier.
        reader.updatePreferences({ enableAutoRefreshSubscription: true });
        reader.stop();
        expect(timers).toEqual([
            "start 120000",
            "stop 120000",
            "start 60000",
            "stop 60000",
            "start 60000",
            "stop 60000"
        ]);
    });

    it("keeps an error message visible over routine messages", async () => {
        const clock = { now: 0 };
        const reader = createReader({ sources: [], now: () => clock.now });
        reader.setMessage("Something failed", { error: true });
        reader.setMessage("Complete prefetch 5 items");
        expect(reader.getState().message.text).toBe("Something failed");
        clock.now = 6000;
        reader.setMessage("Complete prefetch 5 items");
        expect(reader.getState().message.text).toBe("Complete prefetch 5 items");
    });
});
