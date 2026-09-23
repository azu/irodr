import type { Feed, Item, ItemPage, SourceStatus } from "../sources/source.ts";
import { normalizePreferences, type Preferences } from "./preferences.ts";

/**
 * What the reader remembers between calls, as an immutable value, and the pure transitions over it.
 *
 * `createReader` (reader.ts) applies the transitions and performs the side effects;
 * `projectState` (reader-view.ts) derives the public `ReaderState` from the model.
 */

/** Feeds whose loaded items are kept in memory, least recently used first out. */
export const CACHE_LIMIT = 100;
/** Items kept for the Shift+H debug dump. */
export const READ_HISTORY_LIMIT = 100;
/** Routine messages do not replace an error shown within this time. */
export const ERROR_MESSAGE_MS = 5000;

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

/** Items loaded for a feed. An entry never changes: loading older items replaces it. */
export interface CacheEntry {
    readonly revision: string;
    readonly items: readonly Item[];
    readonly continuation?: string;
    /** The items shown with the unread filter on, computed once so unchanged views keep their identity. */
    readonly unreadItems: readonly Item[];
}

export interface ReaderModel {
    /** Opened feed IDs, oldest first. The latest ones stay listed after they are read. */
    readonly history: readonly string[];
    readonly currentFeedId?: string;
    /** The current feed when its source no longer lists it, so it does not vanish while open. */
    readonly retainedCurrent?: Feed;
    /** Target of the navigation in progress; the next `s` continues from it. */
    readonly pendingFeedId?: string;
    /** Names of the collapsed categories. */
    readonly collapsed: ReadonlySet<string>;
    /** Loaded items by feed ID, least recently used first. */
    readonly cache: ReadonlyMap<string, CacheEntry>;
    /** Feeds whose mark-read request is in flight. They are shown with 0 unread. */
    readonly readPending: ReadonlySet<string>;
    /** Show unread items only. Opening a feed turns it on. */
    readonly filterEnabled: boolean;
    readonly focusItemId?: string;
    readonly scrollRequest?: ScrollRequest;
    /** Changed by every navigation. A navigation that started with another token is superseded. */
    readonly navigationToken: number;
    /** Changed by every prefetch run. A run that started with another token stops. */
    readonly prefetchToken: number;
    /** Number of loads in progress that show the loading indicator. */
    readonly loading: number;
    readonly message: Message;
    /** When the latest error message was shown, in epoch milliseconds. */
    readonly errorShownAt: number;
    readonly panel?: Panel;
    readonly preferences: Preferences;
    /** Items marked read in this session, oldest first. */
    readonly readHistory: readonly Item[];
    /** The error message last seen per source ID ("" for none), so each error is reported once. */
    readonly lastErrors: ReadonlyMap<string, string>;
}

export function initialModel(preferences: Preferences): ReaderModel {
    return {
        history: [],
        collapsed: new Set(),
        cache: new Map(),
        readPending: new Set(),
        filterEnabled: true,
        navigationToken: 0,
        prefetchToken: 0,
        loading: 0,
        message: { text: "No messages", id: 0 },
        errorShownAt: -Infinity,
        preferences,
        readHistory: [],
        lastErrors: new Map()
    };
}

// ---------------------------------------------------------------- items

export function cacheEntry(revision: string, items: readonly Item[], continuation: string | undefined): CacheEntry {
    return {
        revision,
        items,
        continuation,
        // Unread items when loaded; revisiting a read feed shows everything instead of nothing.
        unreadItems: items.some((item) => item.unread) ? items.filter((item) => item.unread) : items
    };
}

/** The cached items of `feed`, when they are of its current revision. */
export function freshEntry(model: ReaderModel, feed: Pick<Feed, "id" | "revision">): CacheEntry | undefined {
    const entry = model.cache.get(feed.id);
    return entry?.revision === feed.revision ? entry : undefined;
}

/**
 * Cache items as the most recently used, evicting the least recently used feeds beyond CACHE_LIMIT.
 * The current and the pending feed are never evicted.
 */
export function remember(model: ReaderModel, feedId: string, entry: CacheEntry): ReaderModel {
    const entries = [...[...model.cache].filter(([id]) => id !== feedId), [feedId, entry] as const];
    const evictable = entries
        .map(([id]) => id)
        .filter((id) => id !== model.currentFeedId && id !== model.pendingFeedId);
    const evicted = new Set(evictable.slice(0, Math.max(0, entries.length - CACHE_LIMIT)));
    return { ...model, cache: new Map(entries.filter(([id]) => !evicted.has(id))) };
}

/** Append an older page to a feed's items, skipping items already loaded. Unchanged when the feed is not cached. */
export function withOlderItems(model: ReaderModel, feedId: string, page: ItemPage): ReaderModel {
    const latest = model.cache.get(feedId);
    if (!latest) return model;
    const known = new Set(latest.items.map((item) => item.id));
    return remember(
        model,
        feedId,
        cacheEntry(
            latest.revision,
            [...latest.items, ...page.items.filter((item) => !known.has(item.id))],
            page.continuation
        )
    );
}

// ---------------------------------------------------------------- navigation

/** Start a navigation, superseding the ones in progress. */
export function navigationStarted(model: ReaderModel): ReaderModel {
    return { ...model, navigationToken: model.navigationToken + 1 };
}

/** Start a prefetch run, stopping the one in progress. */
export function prefetchStarted(model: ReaderModel): ReaderModel {
    return { ...model, prefetchToken: model.prefetchToken + 1 };
}

export function withPending(model: ReaderModel, feedId: string | undefined): ReaderModel {
    return { ...model, pendingFeedId: feedId };
}

/**
 * The feed `offset` away in `navigation` (the listed feed IDs), or undefined past the ends.
 * Pressing `s` again while a feed loads moves on from that feed.
 */
export function relativeFeed(model: ReaderModel, navigation: readonly string[], offset: 1 | -1): string | undefined {
    const from = model.pendingFeedId ?? model.currentFeedId;
    if (!from) return offset === 1 ? navigation[0] : undefined;
    const index = navigation.indexOf(from);
    return index === -1 ? (offset === 1 ? navigation[0] : undefined) : navigation[index + offset];
}

/**
 * Show `feed` once its items are cached: the navigation in progress ends and `feed` becomes current,
 * with the unread filter on and the view scrolled to the top. `skipCurrent` forgets the departed feed
 * in the history, so it does not stay listed as recently visited.
 */
export function opened(model: ReaderModel, feed: Feed, skipCurrent: boolean): ReaderModel {
    const settled = withPending(model, undefined);
    const entry = settled.cache.get(feed.id);
    const cached = entry ? remember(settled, feed.id, entry) : settled;
    const history = skipCurrent ? cached.history.slice(0, -1) : cached.history;
    return {
        ...scrolledTo(cached, undefined),
        history: history.at(-1) === feed.id ? history : [...history, feed.id],
        currentFeedId: feed.id,
        retainedCurrent: feed,
        filterEnabled: true,
        focusItemId: undefined
    };
}

// ---------------------------------------------------------------- view

export function withLoading(model: ReaderModel, delta: 1 | -1): ReaderModel {
    return { ...model, loading: Math.max(0, model.loading + delta) };
}

export function withFilter(model: ReaderModel, enabled: boolean): ReaderModel {
    return { ...model, filterEnabled: enabled };
}

export function withFocus(model: ReaderModel, itemId: string | undefined): ReaderModel {
    return { ...model, focusItemId: itemId };
}

/** Request a scroll to `itemId` (the top when undefined), focusing the item. */
export function scrolledTo(model: ReaderModel, itemId: string | undefined): ReaderModel {
    return {
        ...model,
        scrollRequest: { itemId, seq: (model.scrollRequest?.seq ?? 0) + 1 },
        focusItemId: itemId ?? model.focusItemId
    };
}

// ---------------------------------------------------------------- mark read

export function withReadPending(model: ReaderModel, feedId: string): ReaderModel {
    return { ...model, readPending: new Set([...model.readPending, feedId]) };
}

export function withoutReadPending(model: ReaderModel, feedId: string): ReaderModel {
    return { ...model, readPending: new Set([...model.readPending].filter((id) => id !== feedId)) };
}

/** Add items marked read to the history, keeping the latest READ_HISTORY_LIMIT. */
export function withReadHistory(model: ReaderModel, items: readonly Item[]): ReaderModel {
    return { ...model, readHistory: [...model.readHistory, ...items].slice(-READ_HISTORY_LIMIT) };
}

// ---------------------------------------------------------------- UI state

/**
 * Show a message. A routine message does not replace an error shown within ERROR_MESSAGE_MS:
 * the model is returned unchanged then.
 */
export function withMessage(model: ReaderModel, text: string, options: MessageOptions, now: number): ReaderModel {
    if (!options.error && now - model.errorShownAt < ERROR_MESSAGE_MS) return model;
    return {
        ...model,
        message: { text, icon: options.icon, error: options.error, id: model.message.id + 1 },
        errorShownAt: options.error ? now : model.errorShownAt
    };
}

/** Show each source error once, when it first appears. */
export function withSourceErrors(
    model: ReaderModel,
    statuses: readonly { readonly sourceId: string; readonly status: SourceStatus }[],
    now: number
): ReaderModel {
    return statuses.reduce((current, { sourceId, status }) => {
        const message = status.phase === "error" ? status.message : "";
        const reported =
            message && current.lastErrors.get(sourceId) !== message
                ? withMessage(current, message, { error: true }, now)
                : current;
        return reported.lastErrors.get(sourceId) === message
            ? reported
            : { ...reported, lastErrors: new Map([...reported.lastErrors, [sourceId, message]]) };
    }, model);
}

export function withCategoryToggled(model: ReaderModel, name: string): ReaderModel {
    return {
        ...model,
        collapsed: model.collapsed.has(name)
            ? new Set([...model.collapsed].filter((collapsed) => collapsed !== name))
            : new Set([...model.collapsed, name])
    };
}

/** `z`: expand every category if any of `names` is collapsed, otherwise collapse them all. */
export function withAllCategoriesToggled(model: ReaderModel, names: readonly string[]): ReaderModel {
    return { ...model, collapsed: names.some((name) => model.collapsed.has(name)) ? new Set() : new Set(names) };
}

export function withPanel(model: ReaderModel, panel: Panel | undefined): ReaderModel {
    return { ...model, panel };
}

export function withPreferences(model: ReaderModel, preferences: Partial<Preferences>): ReaderModel {
    return { ...model, preferences: normalizePreferences({ ...model.preferences, ...preferences }) };
}
