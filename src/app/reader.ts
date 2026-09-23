import { createStore } from "../lib/store.ts";
import type { Feed, Item, SettingValues, Source } from "../sources/source.ts";
import { DEFAULT_PREFERENCES, type Preferences } from "./preferences.ts";
import {
    type CacheEntry,
    cacheEntry,
    freshEntry,
    initialModel,
    type MessageOptions,
    navigationStarted,
    opened,
    type Panel,
    prefetchStarted,
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
    withPanel,
    withPending,
    withPreferences,
    withReadHistory,
    withReadPending,
    withSourceErrors
} from "./reader-model.ts";
import {
    createAsRead,
    findFeed,
    initialState,
    projectState,
    type ReaderState,
    type StateParts,
    type ViewInputs
} from "./reader-view.ts";

/**
 * The reader: an LDR-style navigation model over any number of sources.
 *
 * Framework independent. React subscribes to it with `useSyncExternalStore`.
 * It never branches on a specific source; differences are expressed by
 * `SourceCapabilities` and handled inside each `Source`.
 *
 * The model (reader-model.ts) is an immutable value changed by pure transitions, and the public state
 * (reader-view.ts) is projected from it and the sources' snapshots; the feed list rules (read feeds leaving
 * the list, recently visited ones staying) live there. This module performs the side effects: source
 * subscriptions, loads, mark-read requests, prefetch and the auto refresh timer.
 */

export type { Message, MessageOptions, Panel, ScrollRequest } from "./reader-model.ts";
export type { ArticleView, CategoryView, FeedListState, ReaderState, SourceView } from "./reader-view.ts";

export type OpenResult = "opened" | "superseded" | "failed" | "missing";

export interface ReaderOptions {
    readonly sources: readonly Source[];
    readonly preferences?: Preferences;
    readonly savePreferences?: (preferences: Preferences) => void;
    readonly openUrl?: (url: string) => void;
    /** Run background work when the browser is idle. */
    readonly scheduleIdle?: (task: () => void) => void;
    readonly setInterval?: (task: () => void, ms: number) => () => void;
    readonly now?: () => number;
}

export interface Reader {
    getState: () => ReaderState;
    subscribe: (listener: () => void) => () => void;
    /** Restore sources, then refresh. Resolves once restored; the refresh continues in the background. */
    start: (url: URL) => Promise<{ consumedUrl: boolean }>;
    stop: () => void;
    /** Sync every connected source. Sources fail independently. */
    refresh: () => Promise<void>;
    /**
     * Open a feed. Leaving a feed marks it read on its source, unless `skipCurrent`.
     * Only the latest navigation takes effect when requests overlap.
     */
    openFeed: (feedId: string, options?: { skipCurrent?: boolean }) => Promise<OpenResult>;
    /** `s`: open the next feed. Feeds that fail to load are skipped. */
    nextFeed: (options?: { skipCurrent?: boolean }) => Promise<void>;
    /** `a`: open the previous feed. */
    prevFeed: () => Promise<void>;
    /** `Shift+S`: open the next feed without marking the current one read. */
    skipFeed: () => Promise<void>;
    /** `m`: mark the current feed read without moving. */
    markCurrentFeedRead: () => Promise<void>;
    /** `Shift+J` / "Read More": show all items and load older ones. */
    loadMore: () => Promise<void>;
    /** `t`: toggle between unread and all items. */
    toggleFilter: () => void;
    setFilter: (enabled: boolean) => void;
    /** Called when scrolling changes the item at the top of the view. */
    focusItem: (itemId: string | undefined) => void;
    /** Focus an item and scroll it to the top. */
    scrollToItem: (itemId: string) => void;
    /** The item after (or before) the focused one, or undefined at the end. */
    adjacentItem: (offset: 1 | -1) => Item | undefined;
    focusedItem: () => Item | undefined;
    /** `v`: open the focused item on its website. */
    openFocusedItem: () => void;
    /** Items marked read in this session, oldest first. */
    readHistory: () => readonly Item[];
    setMessage: (text: string, options?: MessageOptions) => void;
    toggleCategory: (name: string) => void;
    /** `z`: expand every category if any is collapsed, otherwise collapse all. */
    toggleAllCategories: () => void;
    openPanel: (panel: Panel) => void;
    closePanel: () => void;
    updatePreferences: (preferences: Partial<Preferences>) => void;
    /** Run a settings action of a source (connect, disconnect, ...). */
    runSourceAction: (sourceId: string, actionId: string, values: SettingValues) => Promise<string>;
}

/** A load in flight. `token` tells whether a later load of the same feed replaced it. */
interface Load {
    readonly revision: string;
    readonly promise: Promise<CacheEntry>;
    readonly token: object;
}

const EVERYTHING: StateParts = { sources: true, list: true, view: true };

/** Up to `count` feeds following `feedId`, each looked up in `navigation()` as it is when requested. */
function* feedsAfter(navigation: () => readonly string[], feedId: string, count: number): Generator<string> {
    if (count <= 0) return;
    const feedIds = navigation();
    const next = feedIds[feedIds.indexOf(feedId) + 1];
    if (!next) return;
    yield next;
    yield* feedsAfter(navigation, next, count - 1);
}

export function createReader(options: ReaderOptions): Reader {
    const { sources } = options;
    const now = options.now ?? Date.now;
    const asRead = createAsRead();
    const inputs = (): ViewInputs => ({
        sources: sources.map((source) => ({ source, snapshot: source.getSnapshot() })),
        asRead
    });
    const model = createStore<ReaderModel>(initialModel(options.preferences ?? DEFAULT_PREFERENCES));
    const state = createStore<ReaderState>(projectState(initialState(model.get()), model.get(), inputs(), EVERYTHING));

    /** Loads in flight by feed ID. Callers asking for the same revision share one. */
    const loads = new Map<string, Load>();
    /** The refresh in progress. Calls made while it runs share it. */
    const running = new Map<"refresh", Promise<void>>();
    /** Cancels the auto refresh timer. */
    const timers = new Set<() => void>();
    const unsubscribes = new Set<() => void>();

    // ---------------------------------------------------------------- state

    const commit = (parts: StateParts): void => {
        state.update((previous) => projectState(previous, model.get(), inputs(), parts));
    };

    /** Apply a transition to the model, then derive `parts` of the state again. */
    const apply = (transition: (current: ReaderModel) => ReaderModel, parts: StateParts = {}): void => {
        model.update(transition);
        commit(parts);
    };

    const feedById = (feedId: string): Feed | undefined => findFeed(inputs(), model.get(), feedId);

    const sourceOf = (feed: Pick<Feed, "sourceId">): Source => {
        const source = sources.find((candidate) => candidate.id === feed.sourceId);
        if (!source) throw new Error(`Unknown source: ${feed.sourceId}`);
        return source;
    };

    const currentFeed = (): Feed | undefined => {
        const { currentFeedId } = model.get();
        return currentFeedId ? feedById(currentFeedId) : undefined;
    };

    const setMessage = (text: string, messageOptions: MessageOptions = {}): void => {
        const current = model.get();
        const next = withMessage(current, text, messageOptions, now());
        if (next === current) return;
        model.set(next);
        commit({});
    };

    const setLoading = (delta: 1 | -1): void => apply((current) => withLoading(current, delta));

    const setPending = (feedId: string | undefined): void => {
        if (model.get().pendingFeedId === feedId) return;
        apply((current) => withPending(current, feedId), { list: true });
    };

    const openPanel = (panel: Panel): void => apply((current) => withPanel(current, panel));

    // ---------------------------------------------------------------- lifecycle

    const start = async (url: URL): Promise<{ consumedUrl: boolean }> => {
        for (const source of sources) {
            unsubscribes.add(source.subscribe(() => onSourceChange(source)));
        }
        const results = await Promise.all(
            sources.map((source) => source.restore(url).catch(() => ({ consumedUrl: false })))
        );
        commit(EVERYTHING);
        reportSourceErrors();
        if (!sources.some((source) => source.getSnapshot().connected)) {
            openPanel("sources");
        }
        scheduleAutoRefresh();
        refresh().catch(() => undefined);
        return { consumedUrl: results.some((result) => result.consumedUrl) };
    };

    const stopAutoRefresh = (): void => {
        for (const cancel of timers) cancel();
        timers.clear();
    };

    const stop = (): void => {
        stopAutoRefresh();
        for (const unsubscribe of unsubscribes) unsubscribe();
        unsubscribes.clear();
    };

    const scheduleAutoRefresh = (): void => {
        stopAutoRefresh();
        const { enableAutoRefreshSubscription, autoRefreshSubscriptionSec } = model.get().preferences;
        const every = options.setInterval;
        if (!enableAutoRefreshSubscription || !every) return;
        const idle = options.scheduleIdle ?? ((task: () => void) => task());
        timers.add(every(() => idle(refreshInBackground), autoRefreshSubscriptionSec * 1000));
    };

    const syncSources = async (): Promise<void> => {
        const connected = sources.filter((source) => source.getSnapshot().connected);
        const results = await Promise.allSettled(connected.map((source) => source.sync()));
        const problem = sources
            .map((source) => source.getSnapshot())
            .find(
                (snapshot) =>
                    snapshot.status.phase === "error" ||
                    (snapshot.status.phase === "disconnected" && snapshot.feeds.length > 0)
            );
        if (problem) {
            setMessage(problem.status.message, { error: true });
        } else if (results.some((result) => result.status === "rejected")) {
            setMessage("Some sources could not sync. Check Sources authorization or retry later.", {
                error: true
            });
        } else if (connected.length > 0) {
            setMessage("Updated feeds");
        }
    };

    const refresh = (): Promise<void> => {
        const inProgress = running.get("refresh");
        if (inProgress) return inProgress;
        const promise = syncSources().finally(() => {
            running.delete("refresh");
        });
        running.set("refresh", promise);
        return promise;
    };

    const refreshInBackground = (): void => {
        refresh().catch(() => undefined);
    };

    const onSourceChange = (source: Source): void => {
        const current = currentFeed();
        commit(EVERYTHING);
        reportSourceErrors();
        // Keep the open feed in sync with sources that update items in place.
        if (current && current.sourceId === source.id && source.capabilities.liveItems) {
            const feed = feedById(current.id);
            if (feed && model.get().cache.get(feed.id)?.revision !== feed.revision) {
                load(feed)
                    .then(() => commit({ list: true, view: true }))
                    .catch(() => undefined);
            }
        }
    };

    /** Surface a source error in the header once, when it first appears. */
    const reportSourceErrors = (): void => {
        const statuses = sources.map((source) => ({ sourceId: source.id, status: source.getSnapshot().status }));
        apply((current) => withSourceErrors(current, statuses, now()));
    };

    // ---------------------------------------------------------------- loading

    /** Load the first page of a feed, sharing in-flight requests. */
    const load = (feed: Feed): Promise<CacheEntry> => {
        const inflight = loads.get(feed.id);
        if (inflight?.revision === feed.revision) return inflight.promise;
        const token = {};
        const promise = sourceOf(feed)
            .loadItems(feed.id, { count: model.get().preferences.fetchContentsCount })
            .then((page) => {
                const entry = cacheEntry(feed.revision, page.items, page.continuation);
                // A load started later for a newer revision wins, even if this one finishes last.
                if (loads.get(feed.id)?.token === token) {
                    model.update((current) => remember(current, feed.id, entry));
                }
                return entry;
            })
            .finally(() => {
                if (loads.get(feed.id)?.token === token) loads.delete(feed.id);
            });
        loads.set(feed.id, { revision: feed.revision, promise, token });
        return promise;
    };

    // ---------------------------------------------------------------- navigation

    const openFeed = async (feedId: string, openOptions: { skipCurrent?: boolean } = {}): Promise<OpenResult> => {
        const feed = feedById(feedId);
        if (!feed) return "missing";
        model.update(navigationStarted);
        const token = model.get().navigationToken;
        const previousId = model.get().currentFeedId;
        // Reselecting is not navigation: nothing is marked read.
        if (previousId === feedId) {
            setPending(undefined);
            return "opened";
        }
        // Freeze what the reader has seen now; later arrivals must stay unread.
        const departure =
            previousId && !openOptions.skipCurrent
                ? { feed: feedById(previousId), items: model.get().cache.get(previousId)?.items ?? [] }
                : undefined;
        const source = sourceOf(feed);
        if (!freshEntry(model.get(), feed)) {
            const slow = !source.capabilities.liveItems;
            setPending(feedId);
            if (slow) {
                setLoading(1);
                setMessage("Start loading contents...");
            }
            try {
                const loaded = await load(feed);
                if (token !== model.get().navigationToken) return "superseded";
                // A newer load of this feed may still be running and has not cached anything yet.
                if (!model.get().cache.has(feedId)) model.update((current) => remember(current, feedId, loaded));
            } catch {
                if (token !== model.get().navigationToken) return "superseded";
                setPending(undefined);
                setMessage(`Could not load ${feed.title}.`, { error: true });
                return "failed";
            } finally {
                if (slow) setLoading(-1);
            }
            if (slow) setMessage("Finish loading contents");
        }
        apply((current) => opened(current, feed, openOptions.skipCurrent === true), { list: true, view: true });
        if (departure?.feed) {
            markRead(departure.feed, departure.items).catch(() => undefined);
        }
        prefetchAfter(feedId).catch(() => undefined);
        return "opened";
    };

    const nextFeed = async (openOptions: { skipCurrent?: boolean } = {}): Promise<void> => {
        const { navigation } = state.get().list;
        const first = relativeFeed(model.get(), navigation, 1);
        if (!first) return;
        for (const target of navigation.slice(navigation.indexOf(first))) {
            const result = await openFeed(target, openOptions);
            if (result !== "failed") return;
            setMessage(`Can't load... Skip ${feedById(target)?.title ?? target}.`, { error: true });
        }
    };

    const prevFeed = async (): Promise<void> => {
        const target = relativeFeed(model.get(), state.get().list.navigation, -1);
        if (target) await openFeed(target);
    };

    const skipFeed = async (): Promise<void> => {
        if (!model.get().currentFeedId) return;
        setMessage("Skip current subscription");
        await nextFeed({ skipCurrent: true });
    };

    const markCurrentFeedRead = async (): Promise<void> => {
        const feed = currentFeed();
        if (!feed) return;
        await markRead(feed, model.get().cache.get(feed.id)?.items ?? []);
    };

    const markRead = async (feed: Feed, items: readonly Item[]): Promise<void> => {
        const source = sourceOf(feed);
        const before = source.getSnapshot().status;
        apply((current) => withReadPending(current, feed.id), { list: true, view: true });
        try {
            await source.markRead(feed.id, items);
            model.update((current) => withReadHistory(current, items));
        } catch (error) {
            // Show the source's error when this request caused it, e.g. an expired login.
            const status = source.getSnapshot().status;
            setMessage(
                status !== before && status.phase === "error"
                    ? status.message
                    : `Could not mark ${feed.title} as read. ${error instanceof Error ? error.message : ""}`.trim(),
                { error: true }
            );
            throw error;
        } finally {
            apply((current) => withoutReadPending(current, feed.id), { list: true, view: true });
        }
    };

    const prefetchAfter = async (feedId: string): Promise<void> => {
        model.update(prefetchStarted);
        const token = model.get().prefetchToken;
        const count = model.get().preferences.prefetchSubscriptionCount;
        if (count <= 0) return;
        const failed: string[] = [];
        for (const next of feedsAfter(() => state.get().list.navigation, feedId, count)) {
            if (token !== model.get().prefetchToken) break;
            const feed = feedById(next);
            if (feed && !freshEntry(model.get(), feed)) {
                try {
                    await load(feed);
                    // The open feed can be among them when a newer revision arrived.
                    commit({ list: true, view: true });
                } catch {
                    failed.push(next);
                }
            }
        }
        if (token !== model.get().prefetchToken) return;
        if (failed.length > 0) setMessage("Could not prefetch the next feeds.", { error: true });
        else setMessage(`Complete prefetch ${count} items`);
    };

    // ---------------------------------------------------------------- items

    const loadMore = async (): Promise<void> => {
        const feed = currentFeed();
        if (!feed) return;
        apply((current) => withFilter(current, false), { view: true });
        const source = sourceOf(feed);
        const entry = model.get().cache.get(feed.id);
        if (!source.capabilities.loadMore || !entry) return;
        if (!entry.continuation) {
            setMessage("No more past contents");
            return;
        }
        setMessage("Load more past contents");
        setLoading(1);
        try {
            const page = await source.loadItems(feed.id, {
                count: model.get().preferences.fetchContentsCount,
                continuation: entry.continuation
            });
            const current = model.get();
            const next = withOlderItems(current, feed.id, page);
            if (next === current) return;
            model.set(next);
            commit({ view: true });
        } catch {
            setMessage("Could not load more contents.", { error: true });
        } finally {
            setLoading(-1);
        }
    };

    const setFilter = (enabled: boolean): void => {
        if (!state.get().view?.capabilities.unreadFilter) return;
        apply((current) => withFilter(current, enabled), { view: true });
    };

    const focusedItem = (): Item | undefined => {
        const { focusItemId } = model.get();
        return state.get().view?.items.find((item) => item.id === focusItemId);
    };

    // ---------------------------------------------------------------- UI state

    const updatePreferences = (preferences: Partial<Preferences>): void => {
        model.update((current) => withPreferences(current, preferences));
        options.savePreferences?.(model.get().preferences);
        scheduleAutoRefresh();
        commit({});
    };

    return {
        getState: state.get,
        subscribe: state.subscribe,
        start,
        stop,
        refresh,
        openFeed,
        nextFeed,
        prevFeed,
        skipFeed,
        markCurrentFeedRead,
        loadMore,
        toggleFilter: () => setFilter(!state.get().view?.filterEnabled),
        setFilter,
        focusItem: (itemId) => {
            if (model.get().focusItemId === itemId) return;
            apply((current) => withFocus(current, itemId));
        },
        scrollToItem: (itemId) => apply((current) => scrolledTo(current, itemId)),
        adjacentItem: (offset) => {
            const items = state.get().view?.items ?? [];
            const { focusItemId } = model.get();
            const index = items.findIndex((item) => item.id === focusItemId);
            return index === -1 ? undefined : items[index + offset];
        },
        focusedItem,
        openFocusedItem: () => {
            const item = focusedItem();
            if (item?.url) options.openUrl?.(item.url);
        },
        readHistory: () => model.get().readHistory,
        setMessage,
        toggleCategory: (name) => apply((current) => withCategoryToggled(current, name), { list: true }),
        toggleAllCategories: () => {
            const names = state.get().list.categories.map((category) => category.name);
            apply((current) => withAllCategoriesToggled(current, names), { list: true });
        },
        openPanel,
        closePanel: () => apply((current) => withPanel(current, undefined)),
        updatePreferences,
        runSourceAction: async (sourceId, actionId, values) => {
            const message = await sourceOf({ sourceId }).runAction(actionId, values);
            commit(EVERYTHING);
            return message;
        }
    };
}
