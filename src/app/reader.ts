import { shallowEqual } from "../lib/equal.ts";
import { createStore, type Store } from "../lib/store.ts";
import type { Feed, Item, SettingValues, Source, SourceCapabilities, SourceSnapshot } from "../sources/source.ts";
import { DEFAULT_PREFERENCES, normalizePreferences, type Preferences } from "./preferences.ts";

/**
 * The reader: an LDR-style navigation model over any number of sources.
 *
 * Framework independent. React subscribes to it with `useSyncExternalStore`.
 * It never branches on a specific source; differences are expressed by
 * `SourceCapabilities` and handled inside each `Source`.
 */

/** Feeds visited within this many navigations stay listed even when read. */
const RECENT_FEEDS = 5;
/** Feeds whose loaded items are kept in memory, least recently used first out. */
const CACHE_LIMIT = 100;
/** Items kept for the Shift+H debug dump. */
const READ_HISTORY_LIMIT = 100;
/** Routine messages do not replace an error shown within this time. */
const ERROR_MESSAGE_MS = 5000;

export interface SourceView {
    readonly id: string;
    readonly title: string;
    readonly homeUrl?: string;
    readonly snapshot: SourceSnapshot;
}

export interface CategoryView {
    readonly name: string;
    readonly collapsed: boolean;
    readonly feeds: readonly Feed[];
}

export interface FeedListState {
    readonly categories: readonly CategoryView[];
    /** Visible feed IDs in display order, including collapsed categories. */
    readonly navigation: readonly string[];
    readonly currentFeedId?: string;
    /** The feed being opened while its items load. */
    readonly loadingFeedId?: string;
    /** Feeds whose items are loaded and ready to show instantly. */
    readonly prefetched: ReadonlySet<string>;
}

export interface ArticleView {
    readonly feed: Feed;
    readonly capabilities: SourceCapabilities;
    /** Items to display, after the unread filter. */
    readonly items: readonly Item[];
    readonly loadedCount: number;
    readonly filterEnabled: boolean;
    readonly canLoadMore: boolean;
    readonly loaded: boolean;
}

export interface Message {
    readonly text: string;
    readonly icon?: "end";
    readonly error?: boolean;
    readonly id: number;
}

export interface MessageOptions {
    readonly icon?: "end";
    /** Errors stay visible for a while instead of being replaced by routine messages. */
    readonly error?: boolean;
}

export interface ScrollRequest {
    /** Scroll this item to the top. Undefined scrolls the view to the top. */
    readonly itemId?: string;
    readonly seq: number;
}

export type Panel = "sources" | "preferences";

export interface ReaderState {
    readonly sources: readonly SourceView[];
    readonly list: FeedListState;
    readonly view?: ArticleView;
    readonly focusItemId?: string;
    readonly scrollRequest?: ScrollRequest;
    readonly loading: boolean;
    readonly message: Message;
    readonly totals: { readonly unread: number; readonly feeds: number };
    readonly preferences: Preferences;
    readonly panel?: Panel;
}

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

interface CacheEntry {
    readonly revision: string;
    readonly items: readonly Item[];
    readonly continuation?: string;
    /** Memoized display lists, so unchanged views keep their identity. */
    filtered?: readonly Item[];
}

const EMPTY_LIST: FeedListState = { categories: [], navigation: [], prefetched: new Set() };

export class Reader {
    readonly #sources: readonly Source[];
    readonly #options: ReaderOptions;
    readonly #store: Store<ReaderState>;
    readonly #unsubscribes: (() => void)[] = [];

    #history: string[] = [];
    #currentFeedId?: string;
    /** The current feed when its source no longer lists it, so it does not vanish while open. */
    #retainedCurrent?: Feed;
    #collapsed = new Set<string>();
    #cache = new Map<string, CacheEntry>();
    #loads = new Map<string, { revision: string; promise: Promise<CacheEntry>; token: object }>();
    #readPending = new Set<string>();
    #readOverrides = new WeakMap<Feed, Feed>();
    #filterEnabled = true;
    #focusItemId?: string;
    #scrollRequest?: ScrollRequest;
    #navigation = 0;
    /** Target of the navigation in progress; the next `s` continues from it. */
    #pendingFeedId?: string;
    #prefetch = 0;
    #loading = 0;
    #message: Message = { text: "No messages", id: 0 };
    #panel?: Panel;
    #preferences: Preferences;
    #readHistory: Item[] = [];
    #refreshing?: Promise<void>;
    #stopTimer?: () => void;
    #lastErrors = new Map<string, string>();
    #errorShownAt = -Infinity;

    constructor(options: ReaderOptions) {
        this.#options = options;
        this.#sources = options.sources;
        this.#preferences = options.preferences ?? DEFAULT_PREFERENCES;
        this.#store = createStore<ReaderState>({
            sources: [],
            list: EMPTY_LIST,
            loading: false,
            message: this.#message,
            totals: { unread: 0, feeds: 0 },
            preferences: this.#preferences
        });
        this.#commit({ sources: true, list: true, view: true });
    }

    getState = (): ReaderState => this.#store.get();
    subscribe = (listener: () => void): (() => void) => this.#store.subscribe(listener);

    // ---------------------------------------------------------------- lifecycle

    /** Restore sources, then refresh. Resolves once restored; the refresh continues in the background. */
    async start(url: URL): Promise<{ consumedUrl: boolean }> {
        for (const source of this.#sources) {
            this.#unsubscribes.push(source.subscribe(() => this.#onSourceChange(source)));
        }
        const results = await Promise.all(
            this.#sources.map((source) => source.restore(url).catch(() => ({ consumedUrl: false })))
        );
        this.#commit({ sources: true, list: true, view: true });
        this.#reportSourceErrors();
        if (!this.#sources.some((source) => source.getSnapshot().connected)) {
            this.openPanel("sources");
        }
        this.#scheduleAutoRefresh();
        this.refresh().catch(() => undefined);
        return { consumedUrl: results.some((result) => result.consumedUrl) };
    }

    stop(): void {
        this.#stopTimer?.();
        for (const unsubscribe of this.#unsubscribes.splice(0)) unsubscribe();
    }

    #scheduleAutoRefresh(): void {
        this.#stopTimer?.();
        this.#stopTimer = undefined;
        const { enableAutoRefreshSubscription, autoRefreshSubscriptionSec } = this.#preferences;
        const every = this.#options.setInterval;
        if (!enableAutoRefreshSubscription || !every) return;
        const idle = this.#options.scheduleIdle ?? ((task: () => void) => task());
        const refresh = () => {
            this.refresh().catch(() => undefined);
        };
        this.#stopTimer = every(() => idle(refresh), autoRefreshSubscriptionSec * 1000);
    }

    /** Sync every connected source. Sources fail independently. */
    refresh(): Promise<void> {
        this.#refreshing ??= (async () => {
            const connected = this.#sources.filter((source) => source.getSnapshot().connected);
            const results = await Promise.allSettled(connected.map((source) => source.sync()));
            const problem = this.#sources
                .map((source) => source.getSnapshot())
                .find(
                    (snapshot) =>
                        snapshot.status.phase === "error" ||
                        (snapshot.status.phase === "disconnected" && snapshot.feeds.length > 0)
                );
            if (problem) {
                this.setMessage(problem.status.message, { error: true });
            } else if (results.some((result) => result.status === "rejected")) {
                this.setMessage("Some sources could not sync. Check Sources authorization or retry later.", {
                    error: true
                });
            } else if (connected.length > 0) {
                this.setMessage("Updated feeds");
            }
        })().finally(() => {
            this.#refreshing = undefined;
        });
        return this.#refreshing;
    }

    #onSourceChange(source: Source): void {
        const current = this.#currentFeedId ? this.#feed(this.#currentFeedId) : undefined;
        this.#commit({ sources: true, list: true, view: true });
        this.#reportSourceErrors();
        // Keep the open feed in sync with sources that update items in place.
        if (current && current.sourceId === source.id && source.capabilities.liveItems) {
            const feed = this.#feed(current.id);
            if (feed && this.#cache.get(feed.id)?.revision !== feed.revision) {
                this.#load(feed)
                    .then(() => this.#commit({ list: true, view: true }))
                    .catch(() => undefined);
            }
        }
    }

    /** Surface a source error in the header once, when it first appears. */
    #reportSourceErrors(): void {
        for (const source of this.#sources) {
            const { status } = source.getSnapshot();
            const message = status.phase === "error" ? status.message : "";
            if (message && this.#lastErrors.get(source.id) !== message) this.setMessage(message, { error: true });
            this.#lastErrors.set(source.id, message);
        }
    }

    // ---------------------------------------------------------------- feeds

    #allFeeds(): Feed[] {
        return this.#sources.flatMap((source) => source.getSnapshot().feeds);
    }

    #feed(feedId: string): Feed | undefined {
        for (const source of this.#sources) {
            const feed = source.getSnapshot().feeds.find((candidate) => candidate.id === feedId);
            if (feed) return feed;
        }
        // The source no longer lists it, so it has no unread items left.
        return this.#retainedCurrent?.id === feedId ? this.#asRead(this.#retainedCurrent) : undefined;
    }

    #source(feed: Pick<Feed, "sourceId">): Source {
        const source = this.#sources.find((candidate) => candidate.id === feed.sourceId);
        if (!source) throw new Error(`Unknown source: ${feed.sourceId}`);
        return source;
    }

    /** The feed with 0 unread, memoized so its identity is stable across commits. */
    #asRead(feed: Feed): Feed {
        if (feed.unreadCount === 0) return feed;
        const memoized = this.#readOverrides.get(feed);
        if (memoized) return memoized;
        const override = { ...feed, unreadCount: 0 };
        this.#readOverrides.set(feed, override);
        return override;
    }

    /** The feed as displayed: 0 unread while a mark-read request is in flight. */
    #displayed(feed: Feed): Feed {
        return this.#readPending.has(feed.id) ? this.#asRead(feed) : feed;
    }

    #buildList(): { list: FeedListState; totals: ReaderState["totals"] } {
        const feeds = this.#allFeeds();
        if (this.#currentFeedId && !feeds.some((feed) => feed.id === this.#currentFeedId) && this.#retainedCurrent) {
            feeds.push(this.#asRead(this.#retainedCurrent));
        }
        const recent = new Set(this.#history.slice(-RECENT_FEEDS));
        const displayed = feeds.map((feed) => this.#displayed(feed));
        const unread = displayed.reduce((sum, feed) => sum + feed.unreadCount, 0);
        const byCategory = new Map<string, Feed[]>();
        for (const feed of displayed) {
            // Like LDR, read feeds leave the list, except recently visited ones so the list does not shift.
            if (feed.unreadCount === 0 && !recent.has(feed.id) && feed.id !== this.#currentFeedId) continue;
            const category = byCategory.get(feed.category);
            if (category) category.push(feed);
            else byCategory.set(feed.category, [feed]);
        }
        const categories = [...byCategory.keys()].sort().map((name) => ({
            name,
            collapsed: this.#collapsed.has(name),
            feeds: byCategory.get(name) ?? []
        }));
        const previous = this.#store.get().list;
        const revisions = new Map(feeds.map((feed) => [feed.id, feed.revision]));
        const prefetched = new Set(
            [...this.#cache.entries()].filter(([id, entry]) => revisions.get(id) === entry.revision).map(([id]) => id)
        );
        const navigation = categories.flatMap((category) => category.feeds.map((feed) => feed.id));
        return {
            list: {
                categories: sameCategories(previous.categories, categories) ? previous.categories : categories,
                navigation: sameArray(previous.navigation, navigation) ? previous.navigation : navigation,
                currentFeedId: this.#currentFeedId,
                loadingFeedId: this.#pendingFeedId,
                prefetched: sameSet(previous.prefetched, prefetched) ? previous.prefetched : prefetched
            },
            totals: { unread, feeds: feeds.length }
        };
    }

    #buildView(): ArticleView | undefined {
        const id = this.#currentFeedId;
        const raw = id ? this.#feed(id) : undefined;
        if (!id || !raw) return undefined;
        const feed = this.#displayed(raw);
        const source = this.#source(feed);
        const entry = this.#cache.get(id);
        const all = entry?.items ?? [];
        const filterEnabled = this.#filterEnabled && source.capabilities.unreadFilter;
        const items = filterEnabled && entry ? unreadItems(entry) : all;
        const previous = this.#store.get().view;
        const view: ArticleView = {
            feed,
            capabilities: source.capabilities,
            items,
            loadedCount: all.length,
            filterEnabled,
            canLoadMore: source.capabilities.loadMore && entry?.continuation !== undefined,
            loaded: entry !== undefined
        };
        return previous && shallowEqual(previous, view) ? previous : view;
    }

    #commit(parts: { sources?: boolean; list?: boolean; view?: boolean }): void {
        const state = this.#store.get();
        const sources = parts.sources ? this.#buildSources(state.sources) : state.sources;
        const { list, totals } = parts.list ? this.#buildList() : state;
        const next: ReaderState = {
            ...state,
            focusItemId: this.#focusItemId,
            scrollRequest: this.#scrollRequest,
            loading: this.#loading > 0,
            message: this.#message,
            preferences: this.#preferences,
            panel: this.#panel,
            sources,
            list: shallowEqual(list, state.list) ? state.list : list,
            totals: shallowEqual(totals, state.totals) ? state.totals : totals,
            view: parts.view ? this.#buildView() : state.view
        };
        this.#store.set(shallowEqual(next, state) ? state : next);
    }

    /** Source views, keeping the previous ones while their snapshots are unchanged. */
    #buildSources(previous: readonly SourceView[]): readonly SourceView[] {
        const sources = this.#sources.map((source, index) => {
            const snapshot = source.getSnapshot();
            const old = previous[index];
            return old?.snapshot === snapshot
                ? old
                : { id: source.id, title: source.title, homeUrl: source.homeUrl, snapshot };
        });
        return sameArray(previous, sources) ? previous : sources;
    }

    // ---------------------------------------------------------------- loading

    #fresh(feed: Feed): CacheEntry | undefined {
        const entry = this.#cache.get(feed.id);
        return entry?.revision === feed.revision ? entry : undefined;
    }

    /** Load the first page of a feed, sharing in-flight requests. */
    #load(feed: Feed): Promise<CacheEntry> {
        const inflight = this.#loads.get(feed.id);
        if (inflight?.revision === feed.revision) return inflight.promise;
        const token = {};
        const promise = this.#source(feed)
            .loadItems(feed.id, { count: this.#preferences.fetchContentsCount })
            .then((page) => {
                const entry: CacheEntry = {
                    revision: feed.revision,
                    items: page.items,
                    continuation: page.continuation
                };
                // A load started later for a newer revision wins, even if this one finishes last.
                if (this.#loads.get(feed.id)?.token === token) this.#remember(feed.id, entry);
                return entry;
            })
            .finally(() => {
                if (this.#loads.get(feed.id)?.token === token) this.#loads.delete(feed.id);
            });
        this.#loads.set(feed.id, { revision: feed.revision, promise, token });
        return promise;
    }

    /** Cache items, evicting the least recently used feeds beyond CACHE_LIMIT. */
    #remember(feedId: string, entry: CacheEntry): void {
        this.#cache.delete(feedId);
        this.#cache.set(feedId, entry);
        for (const id of this.#cache.keys()) {
            if (this.#cache.size <= CACHE_LIMIT) break;
            if (id !== this.#currentFeedId && id !== this.#pendingFeedId) this.#cache.delete(id);
        }
    }

    #setLoading(delta: 1 | -1): void {
        this.#loading = Math.max(0, this.#loading + delta);
        this.#commit({});
    }

    // ---------------------------------------------------------------- navigation

    /**
     * Open a feed. Leaving a feed marks it read on its source, unless `skipCurrent`.
     * Only the latest navigation takes effect when requests overlap.
     */
    async openFeed(feedId: string, options: { skipCurrent?: boolean } = {}): Promise<OpenResult> {
        const feed = this.#feed(feedId);
        if (!feed) return "missing";
        const token = ++this.#navigation;
        const previousId = this.#currentFeedId;
        // Reselecting is not navigation: nothing is marked read.
        if (previousId === feedId) {
            this.#setPending(undefined);
            return "opened";
        }
        // Freeze what the reader has seen now; later arrivals must stay unread.
        const departure =
            previousId && !options.skipCurrent
                ? { feed: this.#feed(previousId), items: this.#cache.get(previousId)?.items ?? [] }
                : undefined;
        const source = this.#source(feed);
        if (!this.#fresh(feed)) {
            const slow = !source.capabilities.liveItems;
            this.#setPending(feedId);
            if (slow) {
                this.#setLoading(1);
                this.setMessage("Start loading contents...");
            }
            try {
                const loaded = await this.#load(feed);
                if (token !== this.#navigation) return "superseded";
                // A newer load of this feed may still be running and has not cached anything yet.
                if (!this.#cache.has(feedId)) this.#remember(feedId, loaded);
            } catch {
                if (token !== this.#navigation) return "superseded";
                this.#setPending(undefined);
                this.setMessage(`Could not load ${feed.title}.`, { error: true });
                return "failed";
            } finally {
                if (slow) this.#setLoading(-1);
            }
            if (slow) this.setMessage("Finish loading contents");
        }
        this.#pendingFeedId = undefined;
        const opened = this.#cache.get(feedId);
        if (opened) this.#remember(feedId, opened);
        if (options.skipCurrent) this.#history.pop();
        if (this.#history.at(-1) !== feedId) this.#history.push(feedId);
        this.#currentFeedId = feedId;
        this.#retainedCurrent = feed;
        this.#filterEnabled = true;
        this.#focusItemId = undefined;
        this.#scrollTo(undefined, false);
        this.#commit({ list: true, view: true });
        if (departure?.feed) {
            this.#markRead(departure.feed, departure.items).catch(() => undefined);
        }
        this.#prefetchAfter(feedId).catch(() => undefined);
        return "opened";
    }

    #setPending(feedId: string | undefined): void {
        if (this.#pendingFeedId === feedId) return;
        this.#pendingFeedId = feedId;
        this.#commit({ list: true });
    }

    #relative(offset: 1 | -1): string | undefined {
        const { navigation } = this.#store.get().list;
        // Pressing `s` again while a feed loads moves on from that feed.
        const from = this.#pendingFeedId ?? this.#currentFeedId;
        if (!from) return offset === 1 ? navigation[0] : undefined;
        const index = navigation.indexOf(from);
        return index === -1 ? (offset === 1 ? navigation[0] : undefined) : navigation[index + offset];
    }

    /** `s`: open the next feed. Feeds that fail to load are skipped. */
    async nextFeed(options: { skipCurrent?: boolean } = {}): Promise<void> {
        const { navigation } = this.#store.get().list;
        const first = this.#relative(1);
        if (!first) return;
        for (const target of navigation.slice(navigation.indexOf(first))) {
            const result = await this.openFeed(target, options);
            if (result !== "failed") return;
            this.setMessage(`Can't load... Skip ${this.#feed(target)?.title ?? target}.`, { error: true });
        }
    }

    /** `a`: open the previous feed. */
    async prevFeed(): Promise<void> {
        const target = this.#relative(-1);
        if (target) await this.openFeed(target);
    }

    /** `Shift+S`: open the next feed without marking the current one read. */
    async skipFeed(): Promise<void> {
        if (!this.#currentFeedId) return;
        this.setMessage("Skip current subscription");
        await this.nextFeed({ skipCurrent: true });
    }

    /** `m`: mark the current feed read without moving. */
    async markCurrentFeedRead(): Promise<void> {
        const feed = this.#currentFeedId ? this.#feed(this.#currentFeedId) : undefined;
        if (!feed) return;
        await this.#markRead(feed, this.#cache.get(feed.id)?.items ?? []);
    }

    async #markRead(feed: Feed, items: readonly Item[]): Promise<void> {
        const source = this.#source(feed);
        const before = source.getSnapshot().status;
        this.#readPending.add(feed.id);
        this.#commit({ list: true, view: true });
        try {
            await source.markRead(feed.id, items);
            this.#readHistory = [...this.#readHistory, ...items].slice(-READ_HISTORY_LIMIT);
        } catch (error) {
            // Show the source's error when this request caused it, e.g. an expired login.
            const status = source.getSnapshot().status;
            this.setMessage(
                status !== before && status.phase === "error"
                    ? status.message
                    : `Could not mark ${feed.title} as read. ${error instanceof Error ? error.message : ""}`.trim(),
                { error: true }
            );
            throw error;
        } finally {
            this.#readPending.delete(feed.id);
            this.#commit({ list: true, view: true });
        }
    }

    async #prefetchAfter(feedId: string): Promise<void> {
        const token = ++this.#prefetch;
        const count = this.#preferences.prefetchSubscriptionCount;
        if (count <= 0) return;
        const failed: string[] = [];
        for (const next of this.#feedsAfter(feedId, count)) {
            if (token !== this.#prefetch) break;
            const feed = this.#feed(next);
            if (feed && !this.#fresh(feed)) {
                try {
                    await this.#load(feed);
                    // The open feed can be among them when a newer revision arrived.
                    this.#commit({ list: true, view: true });
                } catch {
                    failed.push(next);
                }
            }
        }
        if (token !== this.#prefetch) return;
        if (failed.length > 0) this.setMessage("Could not prefetch the next feeds.", { error: true });
        else this.setMessage(`Complete prefetch ${count} items`);
    }

    /** Up to `count` feeds following `feedId`, each looked up in the list as it is when requested. */
    *#feedsAfter(feedId: string, count: number): Generator<string> {
        if (count <= 0) return;
        const { navigation } = this.#store.get().list;
        const next = navigation[navigation.indexOf(feedId) + 1];
        if (!next) return;
        yield next;
        yield* this.#feedsAfter(next, count - 1);
    }

    // ---------------------------------------------------------------- items

    /** `Shift+J` / "Read More": show all items and load older ones. */
    async loadMore(): Promise<void> {
        const feed = this.#currentFeedId ? this.#feed(this.#currentFeedId) : undefined;
        if (!feed) return;
        this.#filterEnabled = false;
        this.#commit({ view: true });
        const source = this.#source(feed);
        const entry = this.#cache.get(feed.id);
        if (!source.capabilities.loadMore || !entry) return;
        if (!entry.continuation) {
            this.setMessage("No more past contents");
            return;
        }
        this.setMessage("Load more past contents");
        this.#setLoading(1);
        try {
            const page = await source.loadItems(feed.id, {
                count: this.#preferences.fetchContentsCount,
                continuation: entry.continuation
            });
            const latest = this.#cache.get(feed.id);
            if (!latest) return;
            const known = new Set(latest.items.map((item) => item.id));
            this.#remember(feed.id, {
                revision: latest.revision,
                items: [...latest.items, ...page.items.filter((item) => !known.has(item.id))],
                continuation: page.continuation
            });
            this.#commit({ view: true });
        } catch {
            this.setMessage("Could not load more contents.", { error: true });
        } finally {
            this.#setLoading(-1);
        }
    }

    /** `t`: toggle between unread and all items. */
    toggleFilter(): void {
        this.setFilter(!this.#store.get().view?.filterEnabled);
    }

    setFilter(enabled: boolean): void {
        const view = this.#store.get().view;
        if (!view?.capabilities.unreadFilter) return;
        this.#filterEnabled = enabled;
        this.#commit({ view: true });
    }

    /** Called when scrolling changes the item at the top of the view. */
    focusItem(itemId: string | undefined): void {
        if (this.#focusItemId === itemId) return;
        this.#focusItemId = itemId;
        this.#commit({});
    }

    #scrollTo(itemId: string | undefined, commit = true): void {
        this.#scrollRequest = { itemId, seq: (this.#scrollRequest?.seq ?? 0) + 1 };
        if (itemId !== undefined) this.#focusItemId = itemId;
        if (commit) this.#commit({});
    }

    /** Focus an item and scroll it to the top. */
    scrollToItem(itemId: string): void {
        this.#scrollTo(itemId);
    }

    /** The item after (or before) the focused one, or undefined at the end. */
    adjacentItem(offset: 1 | -1): Item | undefined {
        const items = this.#store.get().view?.items ?? [];
        const index = items.findIndex((item) => item.id === this.#focusItemId);
        return index === -1 ? undefined : items[index + offset];
    }

    focusedItem(): Item | undefined {
        return this.#store.get().view?.items.find((item) => item.id === this.#focusItemId);
    }

    /** `v`: open the focused item on its website. */
    openFocusedItem(): void {
        const item = this.focusedItem();
        if (item?.url) this.#options.openUrl?.(item.url);
    }

    /** Items marked read in this session, oldest first. */
    readHistory(): readonly Item[] {
        return this.#readHistory;
    }

    // ---------------------------------------------------------------- UI state

    setMessage(text: string, options: MessageOptions = {}): void {
        const now = (this.#options.now ?? Date.now)();
        if (options.error) this.#errorShownAt = now;
        else if (now - this.#errorShownAt < ERROR_MESSAGE_MS) return;
        this.#message = { text, icon: options.icon, error: options.error, id: this.#message.id + 1 };
        this.#commit({});
    }

    toggleCategory(name: string): void {
        if (this.#collapsed.has(name)) this.#collapsed.delete(name);
        else this.#collapsed.add(name);
        this.#collapsed = new Set(this.#collapsed);
        this.#commit({ list: true });
    }

    /** `z`: expand every category if any is collapsed, otherwise collapse all. */
    toggleAllCategories(): void {
        const names = this.#store.get().list.categories.map((category) => category.name);
        this.#collapsed = names.some((name) => this.#collapsed.has(name)) ? new Set() : new Set(names);
        this.#commit({ list: true });
    }

    openPanel(panel: Panel): void {
        this.#panel = panel;
        this.#commit({});
    }

    closePanel(): void {
        this.#panel = undefined;
        this.#commit({});
    }

    updatePreferences(preferences: Partial<Preferences>): void {
        this.#preferences = normalizePreferences({ ...this.#preferences, ...preferences });
        this.#options.savePreferences?.(this.#preferences);
        this.#scheduleAutoRefresh();
        this.#commit({});
    }

    /** Run a settings action of a source (connect, disconnect, ...). */
    async runSourceAction(sourceId: string, actionId: string, values: SettingValues): Promise<string> {
        const source = this.#source({ sourceId });
        const message = await source.runAction(actionId, values);
        this.#commit({ sources: true, list: true, view: true });
        return message;
    }
}

/** Unread items when loaded; revisiting a read feed shows everything instead of nothing. Memoized on the entry. */
function unreadItems(entry: CacheEntry): readonly Item[] {
    entry.filtered ??= entry.items.some((item) => item.unread)
        ? entry.items.filter((item) => item.unread)
        : entry.items;
    return entry.filtered;
}

function sameCategories(a: readonly CategoryView[], b: readonly CategoryView[]): boolean {
    return (
        a.length === b.length &&
        a.every(
            (category, index) =>
                category.name === b[index]?.name &&
                category.collapsed === b[index].collapsed &&
                category.feeds.length === b[index].feeds.length &&
                category.feeds.every((feed, feedIndex) => feed === b[index]?.feeds[feedIndex])
        )
    );
}

function sameArray<T>(a: readonly T[], b: readonly T[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
    return a.size === b.size && [...a].every((value) => b.has(value));
}
