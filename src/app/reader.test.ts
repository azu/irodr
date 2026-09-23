import { describe, expect, it } from "vite-plus/test";
import { Store } from "../lib/store.ts";
import type {
    Feed,
    Item,
    ItemPage,
    SettingValues,
    Source,
    SourceCapabilities,
    SourceSnapshot
} from "../sources/source.ts";
import { DEFAULT_PREFERENCES } from "./preferences.ts";
import { Reader } from "./reader.ts";

/** An in-memory Source that records what the reader asks for. */
class MemorySource implements Source {
    readonly id: string;
    readonly title: string;
    readonly capabilities: SourceCapabilities;
    readonly marked: { feedId: string; items: string[] }[] = [];
    readonly loads: { feedId: string; continuation?: string }[] = [];
    failLoad = new Set<string>();
    failMarkRead = new Set<string>();
    /** Loads wait for this promise, to simulate a slow network. */
    gate: Promise<void> = Promise.resolve();
    #items = new Map<string, Item[]>();
    #store: Store<SourceSnapshot>;

    constructor(id: string, capabilities: Partial<SourceCapabilities> = {}) {
        this.id = id;
        this.title = id;
        this.capabilities = { loadMore: true, unreadFilter: true, liveItems: false, ...capabilities };
        this.#store = new Store<SourceSnapshot>({
            connected: true,
            status: { phase: "idle", message: "" },
            feeds: [],
            settings: { description: [], fields: [], actions: [] }
        });
    }

    getSnapshot = () => this.#store.get();
    subscribe = (listener: () => void) => this.#store.subscribe(listener);

    setFeed(title: string, items: { title: string; unread?: boolean }[], category = "News"): Feed {
        const id = `${this.id}:${title}`;
        const feed: Feed = {
            id,
            sourceId: this.id,
            title,
            category,
            htmlUrl: `https://example.com/${title}`,
            unreadCount: items.filter((item) => item.unread !== false).length,
            revision: items.map((item) => item.title).join()
        };
        this.#items.set(
            id,
            items.map((item, index) => ({
                id: `${id}/${item.title}`,
                feedId: id,
                title: item.title,
                url: `https://example.com/${item.title}`,
                author: "",
                contentHtml: "",
                publishedAt: 1000 - index,
                updatedAt: 1000 - index,
                unread: item.unread !== false
            }))
        );
        const feeds = this.getSnapshot().feeds.filter((candidate) => candidate.id !== id);
        this.#store.set({ ...this.getSnapshot(), feeds: [...feeds, feed] });
        return feed;
    }

    removeFeed(id: string): void {
        this.#store.set({ ...this.getSnapshot(), feeds: this.getSnapshot().feeds.filter((feed) => feed.id !== id) });
    }

    async restore() {
        return { consumedUrl: false };
    }

    async sync() {}

    async loadItems(feedId: string, options: { count: number; continuation?: string }): Promise<ItemPage> {
        this.loads.push({ feedId, continuation: options.continuation });
        await this.gate;
        if (this.failLoad.has(feedId)) throw new Error("load failed");
        const items = this.#items.get(feedId) ?? [];
        const offset = Number(options.continuation ?? 0);
        const page = items.slice(offset, offset + options.count);
        return {
            items: page,
            continuation: offset + options.count < items.length ? String(offset + options.count) : undefined
        };
    }

    async markRead(feedId: string, loadedItems: readonly Item[]): Promise<void> {
        this.marked.push({ feedId, items: loadedItems.map((item) => item.title) });
        if (this.failMarkRead.has(feedId)) throw new Error("mark failed");
        const feed = this.getSnapshot().feeds.find((candidate) => candidate.id === feedId);
        if (feed) {
            this.#store.set({
                ...this.getSnapshot(),
                feeds: this.getSnapshot().feeds.map((candidate) =>
                    candidate.id === feedId ? { ...candidate, unreadCount: 0 } : candidate
                )
            });
        }
    }

    async runAction(_actionId: string, _values: SettingValues) {
        return "done";
    }
}

async function setup(options: { prefetch?: number; fetch?: number; capabilities?: Partial<SourceCapabilities> } = {}) {
    const source = new MemorySource("memory", options.capabilities);
    source.setFeed("A", [{ title: "a1" }, { title: "a2" }]);
    source.setFeed("B", [{ title: "b1" }, { title: "b2", unread: false }, { title: "b3", unread: false }]);
    source.setFeed("C", [{ title: "c1" }]);
    source.setFeed("Read", [{ title: "r1", unread: false }]);
    source.setFeed("D", [{ title: "d1" }], "Blogs");
    const reader = new Reader({
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
        expect(source.marked).toEqual([{ feedId: "memory:D", items: ["d1"] }]);
        // D stays listed while it is in the recent history.
        expect(listed()).toEqual(["D(0)", "A(2)", "B(1)", "C(1)"]);
    });

    it("reselecting the current feed is not navigation", async () => {
        const { reader, source } = await setup();
        await reader.openFeed("memory:A");
        await reader.openFeed("memory:A");
        await settle();
        expect(source.marked).toEqual([]);
    });

    it("Shift+S skips without marking read, and forgets the skipped feed in the history", async () => {
        const { reader, source, current } = await setup();
        await reader.openFeed("memory:A");
        await reader.skipFeed();
        expect(current()).toBe("B");
        await reader.nextFeed();
        expect(current()).toBe("C");
        await settle();
        expect(source.marked.map((entry) => entry.feedId)).toEqual(["memory:B"]);
        // `a` follows the list order.
        await reader.prevFeed();
        expect(current()).toBe("B");
    });

    it("keeps a feed unread when marking it read fails", async () => {
        const { reader, source, listed } = await setup();
        source.failMarkRead.add("memory:A");
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
        expect(source.loads.filter((load) => load.feedId === "memory:B").map((load) => load.continuation)).toEqual([
            undefined,
            "1",
            "2"
        ]);
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
        expect(source.loads.map((load) => load.feedId)).toEqual(["memory:D", "memory:A", "memory:B"]);
        expect(reader.getState().list.prefetched).toEqual(new Set(["memory:D", "memory:A", "memory:B"]));
        await reader.nextFeed();
        expect(source.loads.filter((load) => load.feedId === "memory:A")).toHaveLength(1);
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
        source.gate = promise;
        const presses = [reader.nextFeed(), reader.nextFeed(), reader.nextFeed()];
        expect(reader.getState().list.loadingFeedId).toBe("memory:B");
        release();
        await Promise.all(presses);
        expect(current()).toBe("B");
        expect(reader.getState().list.loadingFeedId).toBeUndefined();
        await settle();
        // Feeds passed over while loading were never shown, so they stay unread.
        expect(source.marked).toEqual([]);
    });

    it("keeps newer items when an older load finishes last", async () => {
        const { reader, source, titles } = await setup();
        const slow = Promise.withResolvers<void>();
        source.gate = slow.promise;
        const first = reader.openFeed("memory:A");
        // The feed changes while the first load is in flight; opening it again loads the new revision.
        source.setFeed("A", [{ title: "a0" }, { title: "a1" }, { title: "a2" }]);
        source.gate = Promise.resolve();
        expect(await reader.openFeed("memory:A")).toBe("opened");
        slow.resolve();
        expect(await first).toBe("superseded");
        expect(titles()).toEqual(["a0", "a1", "a2"]);
    });

    it("skips feeds that fail to load", async () => {
        const { reader, source, current } = await setup();
        source.failLoad.add("memory:A");
        await reader.openFeed("memory:D");
        await reader.nextFeed();
        expect(current()).toBe("B");
        await settle();
        // The failed feed was never shown, so it is not marked read.
        expect(source.marked.map((entry) => entry.feedId)).toEqual(["memory:D"]);
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

    it("keeps an error message visible over routine messages", async () => {
        let now = 0;
        const reader = new Reader({ sources: [], now: () => now });
        reader.setMessage("Something failed", { error: true });
        reader.setMessage("Complete prefetch 5 items");
        expect(reader.getState().message.text).toBe("Something failed");
        now = 6000;
        reader.setMessage("Complete prefetch 5 items");
        expect(reader.getState().message.text).toBe("Complete prefetch 5 items");
    });
});
