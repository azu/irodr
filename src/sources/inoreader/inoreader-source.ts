import { shallowEqual } from "../../lib/equal.ts";
import { uniqueBy } from "../../lib/unique.ts";
import { decodeEntities, escapeHtml } from "../../lib/html.ts";
import { createStore } from "../../lib/store.ts";
import type {
    Feed,
    Item,
    ItemPage,
    SettingValues,
    Source,
    SourceSettings,
    SourceSnapshot,
    SourceStatus
} from "../source.ts";
import type {
    ItemIdsResponse,
    StreamContentsResponse,
    StreamItemResponse,
    SubscriptionsResponse,
    UnreadCountsResponse
} from "./api-types.ts";
import { createInoreaderOAuth, InoreaderAuthError, type InoreaderOAuthOptions, type OAuthClient } from "./oauth.ts";

export const INOREADER_SOURCE_ID = "inoreader";
const TITLE = "Inoreader";
const FEED_PREFIX = `${INOREADER_SOURCE_ID}:`;
const READ_CATEGORY = /^user\/[^/]+\/state\/com\.google\/read$/;
const STARRED_CATEGORY = /^user\/[^/]+\/state\/com\.google\/starred$/;
const READ_TAG = "user/-/state/com.google/read";
/**
 * Inoreader's Read later: the starred items, from Inoreader's apps or `saveForLater`.
 * https://www.inoreader.com/developers/stream-ids
 */
export const READ_LATER = "user/-/state/com.google/starred";
/** Unread Read later items counted per sync; stream/items/ids returns at most 1000. */
const READ_LATER_COUNT_LIMIT = 1000;
/** How long a local mark-read overrides unread counts that do not reflect it yet. */
const READ_THROUGH_MS = 5 * 60 * 1000;
/** Retry conservatively when a proxy does not expose Inoreader's reset header. */
const RATE_LIMIT_RETRY_MS = 5 * 60 * 1000;
type ApiZone = 1 | 2;
const CAPABILITIES = { loadMore: true, unreadFilter: true, liveItems: false } as const;

export interface InoreaderSourceOptions extends InoreaderOAuthOptions {
    /** Navigate the browser, used for the OAuth redirect. */
    readonly navigate: (url: string) => void;
}

export class InoreaderRequestError extends Error {
    override name = "InoreaderRequestError";
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

const SETTINGS_DESCRIPTION: readonly string[] = [
    "Click Connect to Inoreader, then click Authorize on the Inoreader site."
];

const CUSTOM_APP_DESCRIPTION: readonly string[] = [
    "Optional. Create an app in Inoreader Preferences → Developer (Read and Write scope, no redirect URL needed) and enter its Client ID and secret. Leave both empty to use the default irodr app."
];

/** A mark-read sent by this browser: the timestamp (µs) through which the stream was marked read, and when. */
export interface ReadThrough {
    readonly through: number;
    /** When Inoreader accepted the mark-read, in epoch milliseconds. */
    readonly at: number;
}

/** The state of an Inoreader source. Every change replaces it. Credentials stay in the OAuth storage. */
export interface InoreaderState {
    readonly status: SourceStatus;
    readonly feeds: readonly Feed[];
    /** Stream ID → the latest mark-read of this browser, which overrides unread counts that do not reflect it yet. */
    readonly readThrough: ReadonlyMap<string, ReadThrough>;
}

/** The responses a sync turns into feeds. */
export interface SubscriptionLists {
    readonly subscriptions: SubscriptionsResponse;
    readonly unreadCounts: UnreadCountsResponse;
    /** Unread Read later items, counted by their IDs. Absent when they could not be listed. */
    readonly readLater?: ItemIdsResponse;
}

function idle(message: string): SourceStatus {
    return { phase: "idle", message };
}

function failed(message: string): SourceStatus {
    return { phase: "error", message };
}

function disconnected(): SourceStatus {
    return { phase: "disconnected", message: "Inoreader is not connected." };
}

function isAuthFailure(error: unknown): boolean {
    return error instanceof InoreaderAuthError || (error instanceof InoreaderRequestError && error.status === 401);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Inoreader request failed.";
}

/** Stream IDs of feeds with basic-auth credentials differ between the two endpoints. */
/**
 * An article ID in one form: the hex of `tag:google.com,2005:reader/item/<hex>`. stream/items/ids returns the short
 * form, a signed 64-bit decimal. https://www.inoreader.com/developers/item-ids
 */
export function articleKey(id: string): string {
    const long = /\/item\/([0-9a-f]+)$/i.exec(id)?.[1];
    if (long) return long.toLowerCase().padStart(16, "0");
    return /^-?\d+$/.test(id) ? BigInt.asUintN(64, BigInt(id)).toString(16).padStart(16, "0") : id;
}

function unreadCountId(streamId: string): string {
    return streamId.replace(/(https?):\/\/(\w+):(\w+)@/, "$1://");
}

function feedIdOf(streamId: string): string {
    return `${FEED_PREFIX}${streamId}`;
}

function streamIdOf(feedId: string): string {
    if (!feedId.startsWith(FEED_PREFIX)) throw new Error(`Not an Inoreader feed: ${feedId}`);
    return feedId.slice(FEED_PREFIX.length);
}

function sourceSettings(connected: boolean, custom: OAuthClient | undefined): SourceSettings {
    return {
        description: SETTINGS_DESCRIPTION,
        fields: [],
        advanced: {
            summary: "Use your own Inoreader app",
            description: CUSTOM_APP_DESCRIPTION,
            fields: [
                {
                    name: "clientId",
                    label: "Inoreader App Client Id",
                    type: "text",
                    value: custom?.clientId ?? "",
                    placeholder: "Default irodr app"
                },
                {
                    name: "clientSecret",
                    label: "Inoreader App Client secret",
                    type: "password",
                    value: custom?.clientSecret ?? "",
                    placeholder: "Default irodr app"
                }
            ]
        },
        actions: [
            { id: "connect", label: connected ? "Reconnect to Inoreader" : "Connect to Inoreader", primary: true },
            ...(connected ? [{ id: "disconnect", label: "Disconnect" }] : [])
        ]
    };
}

export function initialState(connected: boolean): InoreaderState {
    return {
        status: connected ? idle("Inoreader is connected.") : disconnected(),
        feeds: [],
        readThrough: new Map()
    };
}

function withStatus(state: InoreaderState, status: SourceStatus): InoreaderState {
    return { ...state, status };
}

/** A stream to list as a feed, with its unread count. */
interface ListedStream {
    readonly streamId: string;
    readonly title: string;
    readonly category: string;
    readonly htmlUrl: string;
    readonly feedUrl?: string;
    readonly iconUrl?: string;
    readonly editUrl?: string;
    readonly count: number;
    readonly countLimit: number;
    /** Microseconds. */
    readonly newest: number;
}

/** Read later as a feed, counting the unread items `stream/items/ids` returned. */
function readLaterStream(unread: ItemIdsResponse, baseUrl: string): ListedStream {
    const refs = unread.itemRefs ?? [];
    return {
        streamId: READ_LATER,
        title: "Read later",
        category: "Inoreader",
        htmlUrl: baseUrl,
        count: refs.length,
        countLimit: READ_LATER_COUNT_LIMIT - 1,
        newest: refs.reduce((newest, ref) => Math.max(newest, Number(ref.timestampUsec) || 0), 0)
    };
}

/**
 * Turn a sync's subscriptions and unread counts into feeds, in subscription order. A mark-read of this
 * browser shows its feed read until the counts reflect it; overrides that no longer apply are dropped.
 */
export function projectFeeds(
    state: InoreaderState,
    lists: SubscriptionLists,
    context: { readonly baseUrl: string; readonly now: number }
): InoreaderState {
    const previous = new Map(state.feeds.map((feed) => [feed.id, feed]));
    const counts = new Map(lists.unreadCounts.unreadcounts.map((count) => [count.id, count]));
    const limit = Number(lists.unreadCounts.max) || 1000;
    // A subscription can be listed twice. It is one feed, as in irodr 1.x, whose repository was keyed by ID:
    // two feeds with one ID would both be current, and `s` would move from one to the other.
    const subscriptions = uniqueBy(lists.subscriptions.subscriptions, (subscription) => subscription.id);
    const streams = [
        ...subscriptions.flatMap((subscription) => {
            const unread = counts.get(unreadCountId(subscription.id));
            // Inoreader returns no unread entry for some streams; irodr 1.x skipped them too.
            if (!unread) return [];
            const stream: ListedStream = {
                streamId: subscription.id,
                title: subscription.title,
                category: subscription.categories[0]?.label ?? "Uncategorized",
                htmlUrl: subscription.htmlUrl,
                feedUrl: subscription.url,
                iconUrl: subscription.iconUrl || undefined,
                editUrl: `${context.baseUrl}/feed/${encodeURIComponent(subscription.url)}`,
                count: Number(unread.count) || 0,
                countLimit: limit,
                newest: Number(unread.newestItemTimestampUsec) || 0
            };
            return [stream];
        }),
        ...(lists.readLater ? [readLaterStream(lists.readLater, context.baseUrl)] : [])
    ];
    const listed = streams.map((stream) => {
        const { count, newest } = stream;
        const readThrough = state.readThrough.get(stream.streamId);
        // Inoreader caught up, or the items were marked unread again elsewhere.
        const outdated = readThrough !== undefined && (count === 0 || context.now - readThrough.at > READ_THROUGH_MS);
        const overridden = readThrough !== undefined && !outdated && newest <= readThrough.through;
        return { stream, unreadCount: overridden ? 0 : count, outdated };
    });
    const dropped = new Set(listed.filter((entry) => entry.outdated).map((entry) => entry.stream.streamId));
    const feeds = listed.map(({ stream, unreadCount }): Feed => {
        const { newest } = stream;
        const feed: Feed = {
            id: feedIdOf(stream.streamId),
            sourceId: INOREADER_SOURCE_ID,
            title: stream.title,
            category: stream.category,
            htmlUrl: stream.htmlUrl,
            feedUrl: stream.feedUrl,
            iconUrl: stream.iconUrl,
            editUrl: stream.editUrl,
            unreadCount,
            unreadCountLimit: stream.countLimit,
            updatedAt: newest ? Math.floor(newest / 1000) : undefined,
            revision: String(newest)
        };
        const old = previous.get(feed.id);
        // Keep object identity for unchanged feeds so the UI skips re-rendering them.
        return old && shallowEqual(old, feed) ? old : feed;
    });
    return {
        ...state,
        feeds,
        readThrough:
            dropped.size === 0
                ? state.readThrough
                : new Map([...state.readThrough].filter(([streamId]) => !dropped.has(streamId)))
    };
}

/**
 * The `ts` of a mark-all-as-read through the newest of `timestamps` (µs), or undefined when none is valid.
 * mark-all-as-read covers articles older than `ts`, so add 1µs to include the newest.
 */
export function markReadTimestamp(timestamps: readonly number[]): number | undefined {
    const valid = timestamps.filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
    return valid.length === 0 ? undefined : valid.reduce((newest, timestamp) => Math.max(newest, timestamp)) + 1;
}

/**
 * Record a mark-read through `through` (µs) that Inoreader accepted at `now`, and show the feed read until
 * the counts reflect it.
 */
export function withMarkedRead(state: InoreaderState, streamId: string, through: number, now: number): InoreaderState {
    const feedId = feedIdOf(streamId);
    return {
        ...state,
        readThrough: new Map(state.readThrough).set(streamId, {
            through: Math.max(state.readThrough.get(streamId)?.through ?? 0, through),
            at: now
        }),
        feeds: state.feeds.map((feed) =>
            feed.id === feedId && feed.unreadCount !== 0 ? { ...feed, unreadCount: 0 } : feed
        )
    };
}

/**
 * Show `marked` unread items of the feed as read. For a mark-read by item IDs, which leaves older unread items of
 * the feed unread: the counts of such a feed come from its unread item IDs, so the next sync has them right.
 */
export function withItemsMarkedRead(state: InoreaderState, streamId: string, marked: number): InoreaderState {
    const feedId = feedIdOf(streamId);
    return {
        ...state,
        feeds: state.feeds.map((feed) =>
            feed.id === feedId && marked > 0 ? { ...feed, unreadCount: Math.max(0, feed.unreadCount - marked) } : feed
        )
    };
}

/** A rejected session disconnects the source; other failures keep the feeds and show the error. */
export function withFailure(state: InoreaderState, error: unknown): InoreaderState {
    return isAuthFailure(error)
        ? {
              ...state,
              feeds: [],
              status: { phase: "disconnected", message: `${errorMessage(error)} Open Sources to connect again.` }
          }
        : withStatus(state, failed(errorMessage(error)));
}

function withDisconnected(state: InoreaderState): InoreaderState {
    return { ...state, feeds: [], status: disconnected() };
}

function toItemContent(item: StreamItemResponse): string {
    const content = item.summary?.content ?? "";
    // Show image enclosures, unless the content already has images.
    if (content.includes("<img")) return content;
    const images = (item.enclosure ?? [])
        .filter((enclosure) => enclosure.type?.startsWith("image/"))
        .map((enclosure) => `<img src="${escapeHtml(enclosure.href)}" alt="" />`)
        .join("");
    return images ? `${content}<div>${images}</div>` : content;
}

export function toItem(feedId: string, streamId: string, response: StreamItemResponse): Item {
    const canonical = (response.canonical ?? []).map((link) => link.href).join(",");
    // Seconds. Guard against missing values: an invalid date must not break rendering.
    const published = response.published || 0;
    const updated = response.updated || published;
    const categories = response.categories ?? [];
    return {
        // The irodr 1.x article ID, deliberately without the first whitespace run only.
        id: `${streamId}--${response.id}--${canonical}`.replace(/\s+/, ""),
        feedId,
        title: decodeEntities(response.title ?? ""),
        url: response.canonical?.[0]?.href ?? response.alternate?.[0]?.href ?? "",
        author: response.author ?? "",
        contentHtml: toItemContent(response),
        publishedAt: published * 1000,
        updatedAt: updated * 1000,
        unread: !categories.some((category) => READ_CATEGORY.test(category)),
        // An item of Read later, also a starred one in its subscription, is saved already; `p` must not save it again.
        ...(feedId === feedIdOf(READ_LATER) || categories.some((category) => STARRED_CATEGORY.test(category))
            ? { savedForLater: true }
            : {})
    };
}

/** Build a Reader API URL. Undefined parameters are left out. */
function apiUrl(baseUrl: string, path: string, params: Readonly<Record<string, string | number | undefined>>): string {
    const url = new URL(`${baseUrl}/reader/api/0${path}`);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
}

export function createInoreaderSource(options: InoreaderSourceOptions): Source {
    const oauth = createInoreaderOAuth(options);
    const state = createStore(initialState(oauth.token() !== undefined));
    const rateLimits = createStore<
        ReadonlyMap<ApiZone, { readonly until: number; readonly error: InoreaderRequestError }>
    >(new Map());
    // Runtime handle: item → its Inoreader timestampUsec, for mark-all-as-read.
    const itemTimestamps = new WeakMap<Item, number>();
    // Runtime handle: item ID → its Inoreader article ID, for edit-tag. Keyed by ID because the reader copies
    // items it marked read.
    const articleIds = new Map<string, string>();
    // Runtime handle: article IDs that edit-tag marked read. The reader may mark the same items again when it
    // leaves the feed, and the count must drop once. Inoreader listing one unread again, in a load or in a
    // sync's unread IDs, clears it.
    const markedRead = new Set<string>();
    // Runtime handle: item ID → the article that `saveForLater` saved for it, so it can be removed again.
    const savedArticles = new Map<string, string>();

    // The connection and the custom client are read from the OAuth storage whenever the state changes.
    const snapshotOf = (current: InoreaderState): SourceSnapshot => {
        const connected = oauth.token() !== undefined;
        return {
            connected,
            status: current.status,
            feeds: current.feeds,
            settings: sourceSettings(connected, oauth.customClient())
        };
    };
    const view = createStore(snapshotOf(state.get()));
    state.subscribe(() => view.set(snapshotOf(state.get())));

    const updateStatus = (status: SourceStatus): void => state.update((current) => withStatus(current, status));

    const request = async (
        path: string,
        params: Readonly<Record<string, string | number | undefined>> = {},
        zone: ApiZone = 1,
        /** Sends a POST request with this body. */
        body?: string | URLSearchParams
    ): Promise<Response> => {
        const checkRateLimit = (): void => {
            const limit = rateLimits.get().get(zone);
            if (limit && options.now() < limit.until) throw limit.error;
        };
        // Also check before OAuth so a blocked request does not renew an expired token.
        checkRateLimit();
        const url = apiUrl(options.baseUrl, path, params);
        const send = async (accessToken: string): Promise<Response> => {
            checkRateLimit();
            try {
                return await options.fetch(`${options.corsProxy}${url}`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    ...(body === undefined ? {} : { method: "POST", body })
                });
            } catch {
                throw new InoreaderRequestError("Could not reach Inoreader. Check your connection.", 0);
            }
        };
        const accessToken = await oauth.accessToken();
        const firstResponse = await send(accessToken);
        // The token may have been revoked or expired early: refresh once.
        const response =
            firstResponse.status === 401 ? await send((await oauth.refresh(accessToken)).accessToken) : firstResponse;
        if (response.status === 429) {
            const seconds = Number(response.headers.get("X-Reader-Limits-Reset-After"));
            const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RATE_LIMIT_RETRY_MS;
            const until = options.now() + delay;
            const error = new InoreaderRequestError(
                `Inoreader Zone ${zone} API limit reached. Retry after ${new Date(until).toLocaleTimeString()}.`,
                429
            );
            rateLimits.update((current) => new Map([...current, [zone, { until, error }]]));
            throw error;
        }
        if (!response.ok) {
            throw new InoreaderRequestError(`Inoreader request failed (HTTP ${response.status}).`, response.status);
        }
        return response;
    };

    const handleFailure = (error: unknown): never => {
        if (isAuthFailure(error)) oauth.clearToken();
        state.update((current) => withFailure(current, error));
        throw error;
    };

    const restore = async (url: URL): Promise<{ consumedUrl: boolean }> => {
        if (!oauth.isCallback(url)) return { consumedUrl: false };
        try {
            await oauth.handleCallback(url);
            updateStatus(idle("Inoreader connected."));
        } catch (error) {
            updateStatus(failed(errorMessage(error)));
        }
        return { consumedUrl: true };
    };

    const sync = async (): Promise<void> => {
        if (!oauth.token()) return;
        updateStatus({ phase: "syncing", message: "Loading Inoreader subscriptions…" });
        try {
            const [subscriptions, unreadCounts, readLater] = await Promise.all([
                request("/subscription/list").then((response) => response.json() as Promise<SubscriptionsResponse>),
                request("/unread-count").then((response) => response.json() as Promise<UnreadCountsResponse>),
                request("/stream/items/ids", { s: READ_LATER, xt: READ_TAG, n: READ_LATER_COUNT_LIMIT })
                    .then((response) => response.json() as Promise<ItemIdsResponse>)
                    // Without Read later the subscriptions are still listed.
                    .catch((error: unknown) => {
                        if (isAuthFailure(error) || (error instanceof InoreaderRequestError && error.status === 429)) {
                            throw error;
                        }
                        return undefined;
                    })
            ]);
            const unreadKeys = new Set((readLater?.itemRefs ?? []).map((ref) => articleKey(ref.id)));
            for (const id of markedRead) if (unreadKeys.has(articleKey(id))) markedRead.delete(id);
            state.update((current) =>
                withStatus(
                    projectFeeds(
                        current,
                        { subscriptions, unreadCounts, readLater },
                        { baseUrl: options.baseUrl, now: options.now() }
                    ),
                    idle("Inoreader is connected.")
                )
            );
        } catch (error) {
            handleFailure(error);
        }
    };

    const loadItems = async (feedId: string, page: { count: number; continuation?: string }): Promise<ItemPage> => {
        const streamId = streamIdOf(feedId);
        try {
            const response = await request(`/stream/contents/${encodeURIComponent(streamId)}`, {
                n: page.count,
                c: page.continuation
            });
            const json = (await response.json()) as StreamContentsResponse;
            const loaded = json.items.map((item) => ({
                item: toItem(feedId, json.id || streamId, item),
                timestamp: Number(item.timestampUsec),
                articleId: item.id
            }));
            for (const { item, timestamp, articleId } of loaded) {
                if (Number.isFinite(timestamp)) itemTimestamps.set(item, timestamp);
                articleIds.set(item.id, articleId);
                if (item.unread) markedRead.delete(articleId);
            }
            return { items: loaded.map(({ item }) => item), continuation: json.continuation || undefined };
        } catch (error) {
            if (isAuthFailure(error) || (error instanceof InoreaderRequestError && error.status === 429)) {
                handleFailure(error);
            }
            throw error;
        }
    };

    const markRead = async (feedId: string, loadedItems: readonly Item[]): Promise<void> => {
        const streamId = streamIdOf(feedId);
        // Through the newest loaded article: later arrivals stay unread.
        const through = markReadTimestamp(loadedItems.map((item) => itemTimestamps.get(item) ?? item.updatedAt * 1000));
        // Nothing was shown, so nothing is marked read.
        if (through === undefined) return;
        try {
            if (streamId === READ_LATER) {
                // mark-all-as-read answered OK for the saved web pages but left them unread, so mark the loaded
                // unread items of this state stream read by their IDs. https://www.inoreader.com/developers/edit-tag
                const ids = loadedItems.flatMap((item) => {
                    const articleId = item.unread ? articleIds.get(item.id) : undefined;
                    return articleId && !markedRead.has(articleId) ? [articleId] : [];
                });
                if (ids.length === 0) return;
                await request(
                    "/edit-tag",
                    {},
                    2,
                    new URLSearchParams([["a", READ_TAG], ...ids.map((id): [string, string] => ["i", id])])
                );
                for (const id of ids) markedRead.add(id);
                state.update((current) => withItemsMarkedRead(current, streamId, ids.length));
                return;
            }
            await request("/mark-all-as-read", { s: streamId, ts: through }, 2);
        } catch (error) {
            if (isAuthFailure(error)) handleFailure(error);
            throw error;
        }
        state.update((current) => withMarkedRead(current, streamId, through, options.now()));
    };

    /**
     * Save the item's page to Read later. Not in the public API documentation: this is the request of Inoreader's
     * browser extension, which lets Inoreader fetch the page by its URL. `star=1` saves to Read later, `star=0`
     * only to Web pages (the extension's "Save target" setting).
     */
    const saveForLater = async (item: Item): Promise<void> => {
        if (!item.url) throw new Error(`${item.title || "The item"} has no URL to save.`);
        try {
            const response = await request("/save-web-page", { url: item.url, return_url: 1, star: 1 }, 2, "{}");
            // The answer is the saved article's path, `/article/<hex>`.
            const saved = /^\/article\/([0-9a-f]+)$/i.exec((await response.text()).trim())?.[1];
            if (saved) savedArticles.set(item.id, `tag:google.com,2005:reader/item/${saved}`);
        } catch (error) {
            if (isAuthFailure(error)) handleFailure(error);
            throw error;
        }
    };

    /**
     * Remove the item from Read later: unstar its article. Known for items saved in this session and for Inoreader's
     * own items; other items are not matched by URL.
     */
    const removeFromLater = async (item: Item): Promise<void> => {
        const articleId = savedArticles.get(item.id) ?? articleIds.get(item.id);
        if (!articleId) throw new Error("Remove it from Read later in Inoreader.");
        try {
            await request(
                "/edit-tag",
                {},
                2,
                new URLSearchParams([
                    ["r", READ_LATER],
                    ["i", articleId]
                ])
            );
        } catch (error) {
            if (isAuthFailure(error)) handleFailure(error);
            throw error;
        }
        savedArticles.delete(item.id);
    };

    const runAction = async (actionId: string, values: SettingValues): Promise<string> => {
        switch (actionId) {
            case "connect": {
                const clientId = typeof values.clientId === "string" ? values.clientId : "";
                const clientSecret = typeof values.clientSecret === "string" ? values.clientSecret : "";
                oauth.setCustomClient({ clientId, clientSecret });
                options.navigate(oauth.authorizeUrl());
                return "Opening Inoreader authorization…";
            }
            case "disconnect":
                oauth.clearToken();
                state.update(withDisconnected);
                return "Inoreader disconnected.";
            default:
                throw new Error(`Unknown action: ${actionId}`);
        }
    };

    return {
        id: INOREADER_SOURCE_ID,
        title: TITLE,
        homeUrl: options.baseUrl,
        capabilities: CAPABILITIES,
        getSnapshot: view.get,
        subscribe: view.subscribe,
        restore,
        sync,
        loadItems,
        markRead,
        saveForLater,
        removeFromLater,
        runAction
    };
}
