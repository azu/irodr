import { describe, expect, it } from "vite-plus/test";
import type { Feed, Item, SourceStatus } from "../sources/source.ts";
import { DEFAULT_PREFERENCES } from "./preferences.ts";
import {
    CACHE_LIMIT,
    cacheEntry,
    ERROR_MESSAGE_MS,
    freshEntry,
    initialModel,
    navigationStarted,
    opened,
    prefetchStarted,
    READ_HISTORY_LIMIT,
    RECENT_FEEDS,
    type ReaderModel,
    relativeFeed,
    remember,
    scrolledTo,
    withAllCategoriesToggled,
    withCategoryToggled,
    withFilter,
    withFocus,
    withLoading,
    withMessage,
    withOlderItems,
    withoutReadPending,
    withPending,
    withPreferences,
    withReadHistory,
    withReadItems,
    withReadPending,
    withRetainedItems,
    withSourceErrors
} from "./reader-model.ts";

const model = initialModel(DEFAULT_PREFERENCES);

const item = (id: string, unread = true): Item => ({
    id,
    feedId: "memory:A",
    title: id,
    url: `https://example.com/${id}`,
    author: "",
    contentHtml: "",
    publishedAt: 0,
    updatedAt: 0,
    unread
});

const feed = (id: string, revision = "1"): Feed => ({
    id,
    sourceId: "memory",
    title: id,
    category: "News",
    htmlUrl: `https://example.com/${id}`,
    unreadCount: 1,
    revision
});

const entry = (revision = "1", items: readonly Item[] = []) => cacheEntry(revision, items, undefined);

/** `base` with feeds f0, f1, ... cached in that order. */
const withCached = (base: ReaderModel, count: number): ReaderModel =>
    Array.from({ length: count }, (_, index) => `f${index}`).reduce(
        (current, id) => remember(current, id, entry()),
        base
    );

const status = (phase: SourceStatus["phase"], message: string) => ({ sourceId: "memory", status: { phase, message } });

describe("cache", () => {
    it("filters unread items when the entry is created", () => {
        const items = [item("a1"), item("a2", false)];
        const cached = cacheEntry("1", items, "next");
        expect(cached.unreadItems).toEqual([items[0]]);
        expect(cached.continuation).toBe("next");
    });

    it("shows every item of a read feed instead of nothing", () => {
        const items = [item("a1", false), item("a2", false)];
        expect(cacheEntry("1", items, undefined).unreadItems).toBe(items);
    });

    it("finds cached items of the feed's current revision only", () => {
        const cached = remember(model, "A", entry("1"));
        expect(freshEntry(cached, feed("A", "1"))).toBe(cached.cache.get("A"));
        expect(freshEntry(cached, feed("A", "2"))).toBeUndefined();
    });

    it("moves a remembered feed to the most recently used end", () => {
        const cached = withCached(model, 3);
        const next = remember(cached, "f0", entry("2"));
        expect([...next.cache.keys()]).toEqual(["f1", "f2", "f0"]);
        expect(next.cache.get("f0")?.revision).toBe("2");
        expect([...cached.cache.keys()]).toEqual(["f0", "f1", "f2"]);
    });

    it("evicts the least recently used feeds beyond the limit", () => {
        const cached = withCached(model, CACHE_LIMIT + 2);
        expect(cached.cache.size).toBe(CACHE_LIMIT);
        expect([...cached.cache.keys()].slice(0, 2)).toEqual(["f2", "f3"]);
        expect(cached.cache.has(`f${CACHE_LIMIT + 1}`)).toBe(true);
    });

    it("never evicts the current or the pending feed", () => {
        const full = withCached(model, CACHE_LIMIT);
        const navigating = withPending({ ...full, currentFeedId: "f0" }, "f1");
        const next = remember(navigating, "new", entry());
        expect(next.cache.size).toBe(CACHE_LIMIT);
        expect([...next.cache.keys()].slice(0, 2)).toEqual(["f0", "f1"]);
        expect(next.cache.has("f2")).toBe(false);
        expect(next.cache.has("new")).toBe(true);
    });

    it("appends older items, skipping those already loaded", () => {
        const cached = remember(model, "A", cacheEntry("1", [item("a1", false), item("a2", false)], "2"));
        const next = withOlderItems(cached, "A", { items: [item("a2", false), item("a3")], continuation: undefined });
        const appended = next.cache.get("A");
        expect(appended?.items.map((loaded) => loaded.id)).toEqual(["a1", "a2", "a3"]);
        expect(appended?.unreadItems.map((loaded) => loaded.id)).toEqual(["a3"]);
        expect(appended?.continuation).toBeUndefined();
        expect(appended?.revision).toBe("1");
    });

    it("ignores older items of a feed that is no longer cached", () => {
        expect(withOlderItems(model, "A", { items: [item("a1")] })).toBe(model);
    });
});

describe("navigation", () => {
    it("gives every navigation and prefetch run a new token", () => {
        const first = navigationStarted(model);
        expect(navigationStarted(first).navigationToken).not.toBe(first.navigationToken);
        const prefetch = prefetchStarted(model);
        expect(prefetchStarted(prefetch).prefetchToken).not.toBe(prefetch.prefetchToken);
    });

    it("opening a feed ends the navigation, records the visit and resets the view", () => {
        const loading = withFilter(withFocus(withPending(remember(model, "A", entry()), "A"), "a1"), false);
        const next = opened(loading, feed("A"), false);
        expect(next).toMatchObject({
            currentFeedId: "A",
            pendingFeedId: undefined,
            retainedCurrent: feed("A"),
            history: ["A"],
            filterEnabled: true,
            focusItemId: undefined,
            scrollRequest: { itemId: undefined, seq: 1 }
        });
    });

    it("opening a feed marks its items as the most recently used", () => {
        const cached = remember(remember(model, "A", entry()), "B", entry());
        expect([...opened(cached, feed("A"), false).cache.keys()]).toEqual(["B", "A"]);
    });

    it("skipping forgets the departed feed in the history", () => {
        const visited = opened(opened(model, feed("A"), false), feed("B"), false);
        expect(visited.history).toEqual(["A", "B"]);
        expect(opened(visited, feed("C"), true).history).toEqual(["A", "C"]);
        // The skipped-to feed is not recorded twice when it was the one before.
        expect(opened(visited, feed("A"), true).history).toEqual(["A"]);
    });

    it("moves on from the loading feed, then from the current one", () => {
        const navigation = ["A", "B", "C"];
        expect(relativeFeed(model, navigation, 1)).toBe("A");
        expect(relativeFeed(model, navigation, -1)).toBeUndefined();
        const current = opened(model, feed("A"), false);
        expect(relativeFeed(current, navigation, 1)).toBe("B");
        expect(relativeFeed(current, navigation, -1)).toBeUndefined();
        expect(relativeFeed(withPending(current, "B"), navigation, 1)).toBe("C");
        expect(relativeFeed(withPending(current, "B"), navigation, -1)).toBe("A");
        expect(relativeFeed(opened(model, feed("C"), false), navigation, 1)).toBeUndefined();
        // A current feed that left the list starts over from the top.
        const unlisted = opened(model, feed("Z"), false);
        expect(relativeFeed(unlisted, navigation, 1)).toBe("A");
        expect(relativeFeed(unlisted, navigation, -1)).toBeUndefined();
    });
});

describe("view", () => {
    it("scrolling to an item focuses it, and scrolling to the top keeps the focus", () => {
        const scrolled = scrolledTo(model, "a1");
        expect(scrolled.scrollRequest).toEqual({ itemId: "a1", seq: 1 });
        expect(scrolled.focusItemId).toBe("a1");
        const top = scrolledTo(scrolled, undefined);
        expect(top.scrollRequest).toEqual({ itemId: undefined, seq: 2 });
        expect(top.focusItemId).toBe("a1");
    });

    it("never counts loads below zero", () => {
        expect(withLoading(model, -1).loading).toBe(0);
        expect(withLoading(withLoading(model, 1), 1).loading).toBe(2);
    });

    it("merges changes into the current preferences and normalizes them", () => {
        const custom = withPreferences(model, { prefetchSubscriptionCount: 2 });
        expect(withPreferences(custom, { fetchContentsCount: 1000 }).preferences).toEqual({
            ...DEFAULT_PREFERENCES,
            prefetchSubscriptionCount: 2,
            fetchContentsCount: 100
        });
    });
});

describe("mark read", () => {
    it("tracks the feeds whose request is in flight", () => {
        const pending = withReadPending(withReadPending(model, "A"), "B");
        expect(pending.readPending).toEqual(new Set(["A", "B"]));
        expect(withoutReadPending(pending, "A").readPending).toEqual(new Set(["B"]));
        expect(model.readPending).toEqual(new Set());
    });

    it("keeps the latest items marked read", () => {
        const items = Array.from({ length: READ_HISTORY_LIMIT + 1 }, (_, index) => item(`i${index}`));
        const history = withReadHistory(withReadHistory(model, items.slice(0, 1)), items.slice(1)).readHistory;
        expect(history).toHaveLength(READ_HISTORY_LIMIT);
        expect(history[0]?.id).toBe("i1");
        expect(history.at(-1)?.id).toBe(`i${READ_HISTORY_LIMIT}`);
    });

    it("keeps the items it marked read as read, for a feed the source no longer returns them for", () => {
        const visited = opened(model, feed("A"), false);
        const read = withReadItems(withReadItems(visited, "A", [item("a1")]), "A", [item("a2"), item("a1")]);
        expect(read.readItems.get("A")).toEqual([item("a2", false), item("a1", false)]);
        // A reload returns what the source still has, followed by the read items it lacks.
        expect(withRetainedItems(read, "A", [item("a3")]).map((loaded) => loaded.id)).toEqual(["a3", "a2", "a1"]);
        const unchanged = [item("a2", false), item("a1", false)];
        expect(withRetainedItems(read, "A", unchanged)).toBe(unchanged);
    });

    it("adds read items to the cached items of a reload that finished first", () => {
        const reloaded = remember(opened(model, feed("A"), false), "A", entry("empty", []));
        const read = withReadItems(reloaded, "A", [item("a1")]);
        expect(read.cache.get("A")?.revision).toBe("empty");
        expect(read.cache.get("A")?.items).toEqual([item("a1", false)]);
    });

    it("keeps read items only while the feed is recently visited", () => {
        expect(withReadItems(model, "A", [item("a1")])).toBe(model);
        const visited = withReadItems(opened(model, feed("A"), false), "A", [item("a1")]);
        const later = Array.from({ length: RECENT_FEEDS - 1 }, (_, index) => feed(`f${index}`)).reduce(
            (current, next) => opened(current, next, false),
            visited
        );
        expect(later.readItems.has("A")).toBe(true);
        expect(opened(later, feed("next"), false).readItems.has("A")).toBe(false);
    });
});

describe("messages", () => {
    it("keeps an error visible over routine messages for a while", () => {
        const failed = withMessage(model, "Something failed", { error: true }, 1000);
        expect(failed.message).toEqual({ text: "Something failed", icon: undefined, error: true, id: 1 });
        expect(withMessage(failed, "Updated feeds", {}, 1000 + ERROR_MESSAGE_MS - 1)).toBe(failed);
        expect(withMessage(failed, "Updated feeds", {}, 1000 + ERROR_MESSAGE_MS).message).toEqual({
            text: "Updated feeds",
            icon: undefined,
            error: undefined,
            id: 2
        });
    });

    it("replaces an error with a newer error, which restarts the delay", () => {
        const first = withMessage(model, "First", { error: true }, 0);
        const second = withMessage(first, "Second", { error: true }, 4000);
        expect(second.message.text).toBe("Second");
        expect(withMessage(second, "Routine", {}, ERROR_MESSAGE_MS)).toBe(second);
    });

    it("numbers messages, so the same text shows again", () => {
        const first = withMessage(model, "End of contents", { icon: "end" }, 0);
        const second = withMessage(first, "End of contents", { icon: "end" }, 0);
        expect(second.message).toEqual({ text: "End of contents", icon: "end", error: undefined, id: 2 });
    });

    it("reports a source error once, when it first appears", () => {
        const reported = withSourceErrors(model, [status("error", "Expired")], 0);
        expect(reported.message).toMatchObject({ text: "Expired", error: true, id: 1 });
        expect(withSourceErrors(reported, [status("error", "Expired")], 1).message).toBe(reported.message);
        // Once cleared, the same error is reported again.
        const cleared = withSourceErrors(reported, [status("idle", "")], 2);
        expect(cleared.message).toBe(reported.message);
        expect(withSourceErrors(cleared, [status("error", "Expired")], 3).message.id).toBe(2);
    });

    it("reports only error statuses", () => {
        const next = withSourceErrors(model, [status("syncing", "Syncing...")], 0);
        expect(next.message).toBe(model.message);
        expect(next.lastErrors).toEqual(new Map([["memory", ""]]));
    });
});

describe("categories", () => {
    it("toggles one category", () => {
        const collapsed = withCategoryToggled(model, "News");
        expect(collapsed.collapsed).toEqual(new Set(["News"]));
        expect(withCategoryToggled(collapsed, "News").collapsed).toEqual(new Set());
        expect(model.collapsed).toEqual(new Set());
    });

    it("z collapses every category, or expands them all when any is collapsed", () => {
        const names = ["Blogs", "News"];
        expect(withAllCategoriesToggled(model, names).collapsed).toEqual(new Set(names));
        expect(withAllCategoriesToggled(withCategoryToggled(model, "News"), names).collapsed).toEqual(new Set());
        // Categories no longer listed do not count.
        expect(withAllCategoriesToggled(withCategoryToggled(model, "Gone"), names).collapsed).toEqual(new Set(names));
    });
});
