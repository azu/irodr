import { shallowEqual } from "../lib/equal.ts";
import type { Feed, Item, Source, SourceCapabilities, SourceSnapshot } from "../sources/source.ts";
import type { Preferences } from "./preferences.ts";
import type { Message, Panel, ReaderModel, ScrollRequest } from "./reader-model.ts";

/**
 * The public reader state, projected from the model and the sources' snapshots.
 *
 * The projection keeps the previous objects (lists, categories, views, the 0-unread copies of feeds) while their
 * contents are unchanged, so components selecting them with `useSyncExternalStore` do not re-render.
 */

/** Feeds visited within this many navigations stay listed even when read. */
const RECENT_FEEDS = 5;

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

/** The parts of the state to derive again. The others keep their previous value. */
export interface StateParts {
    readonly sources?: boolean;
    readonly list?: boolean;
    readonly view?: boolean;
}

/** A source with its snapshot, read once per projection. */
export interface SourceInput {
    readonly source: Pick<Source, "id" | "title" | "homeUrl" | "capabilities">;
    readonly snapshot: SourceSnapshot;
}

/** The feed with 0 unread. */
export type AsRead = (feed: Feed) => Feed;

/** What the projection reads besides the model. */
export interface ViewInputs {
    readonly sources: readonly SourceInput[];
    /** Returns the same copy for the same feed, so its identity is stable across projections. */
    readonly asRead: AsRead;
}

const EMPTY_LIST: FeedListState = { categories: [], navigation: [], prefetched: new Set() };

/** `AsRead`, memoized per feed object. */
export function createAsRead(): AsRead {
    const copies = new WeakMap<Feed, Feed>();
    return (feed) => {
        if (feed.unreadCount === 0) return feed;
        const memoized = copies.get(feed);
        if (memoized) return memoized;
        const copy = { ...feed, unreadCount: 0 };
        copies.set(feed, copy);
        return copy;
    };
}

/** The state before the first projection. */
export function initialState(model: ReaderModel): ReaderState {
    return {
        sources: [],
        list: EMPTY_LIST,
        loading: false,
        message: model.message,
        totals: { unread: 0, feeds: 0 },
        preferences: model.preferences
    };
}

export function findFeed(inputs: ViewInputs, model: ReaderModel, feedId: string): Feed | undefined {
    for (const { snapshot } of inputs.sources) {
        const feed = snapshot.feeds.find((candidate) => candidate.id === feedId);
        if (feed) return feed;
    }
    // The source no longer lists it, so it has no unread items left.
    return model.retainedCurrent?.id === feedId ? inputs.asRead(model.retainedCurrent) : undefined;
}

/**
 * The next state: `parts` are derived again from the model and the inputs, and the other fields of the model
 * are copied. Values equal to the previous ones keep the previous objects; nothing changed returns `previous`.
 */
export function projectState(
    previous: ReaderState,
    model: ReaderModel,
    inputs: ViewInputs,
    parts: StateParts
): ReaderState {
    const sources = parts.sources ? sourceViews(previous.sources, inputs.sources) : previous.sources;
    const { list, totals } = parts.list ? feedList(previous.list, model, inputs) : previous;
    const next: ReaderState = {
        ...previous,
        focusItemId: model.focusItemId,
        scrollRequest: model.scrollRequest,
        loading: model.loading > 0,
        message: model.message,
        preferences: model.preferences,
        panel: model.panel,
        sources,
        list: shallowEqual(list, previous.list) ? previous.list : list,
        totals: shallowEqual(totals, previous.totals) ? previous.totals : totals,
        view: parts.view ? articleView(previous.view, model, inputs) : previous.view
    };
    return shallowEqual(next, previous) ? previous : next;
}

/** Source views, keeping the previous ones while their snapshots are unchanged. */
function sourceViews(previous: readonly SourceView[], inputs: readonly SourceInput[]): readonly SourceView[] {
    const sources = inputs.map(({ source, snapshot }, index) => {
        const old = previous[index];
        return old?.snapshot === snapshot
            ? old
            : { id: source.id, title: source.title, homeUrl: source.homeUrl, snapshot };
    });
    return sameArray(previous, sources) ? previous : sources;
}

/** The feed as displayed: 0 unread while a mark-read request is in flight. */
function displayed(model: ReaderModel, inputs: ViewInputs, feed: Feed): Feed {
    return model.readPending.has(feed.id) ? inputs.asRead(feed) : feed;
}

function feedList(
    previous: FeedListState,
    model: ReaderModel,
    inputs: ViewInputs
): { list: FeedListState; totals: ReaderState["totals"] } {
    const { currentFeedId, retainedCurrent } = model;
    const listed = inputs.sources.flatMap(({ snapshot }) => snapshot.feeds);
    const feeds =
        currentFeedId && !listed.some((feed) => feed.id === currentFeedId) && retainedCurrent
            ? [...listed, inputs.asRead(retainedCurrent)]
            : listed;
    const recent = new Set(model.history.slice(-RECENT_FEEDS));
    const shown = feeds.map((feed) => displayed(model, inputs, feed));
    const unread = shown.reduce((sum, feed) => sum + feed.unreadCount, 0);
    const byCategory = Map.groupBy(
        // Like LDR, read feeds leave the list, except recently visited ones so the list does not shift.
        shown.filter((feed) => feed.unreadCount !== 0 || recent.has(feed.id) || feed.id === currentFeedId),
        (feed) => feed.category
    );
    const categories = [...byCategory.keys()].toSorted().map((name) => ({
        name,
        collapsed: model.collapsed.has(name),
        feeds: byCategory.get(name) ?? []
    }));
    const revisions = new Map(feeds.map((feed) => [feed.id, feed.revision]));
    const prefetched = new Set(
        [...model.cache].filter(([id, entry]) => revisions.get(id) === entry.revision).map(([id]) => id)
    );
    const navigation = categories.flatMap((category) => category.feeds.map((feed) => feed.id));
    return {
        list: {
            categories: sameCategories(previous.categories, categories) ? previous.categories : categories,
            navigation: sameArray(previous.navigation, navigation) ? previous.navigation : navigation,
            currentFeedId,
            loadingFeedId: model.pendingFeedId,
            prefetched: sameSet(previous.prefetched, prefetched) ? previous.prefetched : prefetched
        },
        totals: { unread, feeds: feeds.length }
    };
}

function articleView(
    previous: ArticleView | undefined,
    model: ReaderModel,
    inputs: ViewInputs
): ArticleView | undefined {
    const id = model.currentFeedId;
    const raw = id ? findFeed(inputs, model, id) : undefined;
    if (!id || !raw) return undefined;
    const feed = displayed(model, inputs, raw);
    const { capabilities } = sourceOf(inputs, feed);
    const entry = model.cache.get(id);
    const all = entry?.items ?? [];
    const filterEnabled = model.filterEnabled && capabilities.unreadFilter;
    const view: ArticleView = {
        feed,
        capabilities,
        items: filterEnabled && entry ? entry.unreadItems : all,
        loadedCount: all.length,
        filterEnabled,
        canLoadMore: capabilities.loadMore && entry?.continuation !== undefined,
        loaded: entry !== undefined
    };
    return previous && shallowEqual(previous, view) ? previous : view;
}

function sourceOf(inputs: ViewInputs, feed: Pick<Feed, "sourceId">): SourceInput["source"] {
    const input = inputs.sources.find(({ source }) => source.id === feed.sourceId);
    if (!input) throw new Error(`Unknown source: ${feed.sourceId}`);
    return input.source;
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
