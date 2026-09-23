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
/** How long a local mark-read overrides unread counts that do not reflect it yet. */
const READ_THROUGH_MS = 5 * 60 * 1000;
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
    "Click Connect to Inoreader, then click Authorize on the Inoreader site.",
    "To use your own Inoreader app, create one in Inoreader Preferences → Developer (Read and Write scope, no redirect URL needed) and enter its Client ID and secret. Leave both empty to use the default app."
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
        ],
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
    const listed = subscriptions.flatMap((subscription) => {
        const unread = counts.get(unreadCountId(subscription.id));
        // Inoreader returns no unread entry for some streams; irodr 1.x skipped them too.
        if (!unread) return [];
        const count = Number(unread.count) || 0;
        const newest = Number(unread.newestItemTimestampUsec) || 0;
        const readThrough = state.readThrough.get(subscription.id);
        // Inoreader caught up, or the items were marked unread again elsewhere.
        const outdated = readThrough !== undefined && (count === 0 || context.now - readThrough.at > READ_THROUGH_MS);
        const overridden = readThrough !== undefined && !outdated && newest <= readThrough.through;
        return [{ subscription, unreadCount: overridden ? 0 : count, newest, outdated }];
    });
    const dropped = new Set(listed.filter((entry) => entry.outdated).map((entry) => entry.subscription.id));
    const feeds = listed.map(({ subscription, unreadCount, newest }): Feed => {
        const feed: Feed = {
            id: feedIdOf(subscription.id),
            sourceId: INOREADER_SOURCE_ID,
            title: subscription.title,
            category: subscription.categories[0]?.label ?? "Uncategorized",
            htmlUrl: subscription.htmlUrl,
            feedUrl: subscription.url,
            iconUrl: subscription.iconUrl || undefined,
            editUrl: `${context.baseUrl}/feed/${encodeURIComponent(subscription.url)}`,
            unreadCount,
            unreadCountLimit: limit,
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
        unread: !(response.categories ?? []).some((category) => READ_CATEGORY.test(category))
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
    // Runtime handle: item → its Inoreader timestampUsec, for mark-all-as-read.
    const itemTimestamps = new WeakMap<Item, number>();

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
        params: Readonly<Record<string, string | number | undefined>> = {}
    ): Promise<Response> => {
        const url = apiUrl(options.baseUrl, path, params);
        const send = async (accessToken: string): Promise<Response> => {
            try {
                return await options.fetch(`${options.corsProxy}${url}`, {
                    headers: { Authorization: `Bearer ${accessToken}` }
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
            const [subscriptions, unreadCounts] = await Promise.all([
                request("/subscription/list").then((response) => response.json() as Promise<SubscriptionsResponse>),
                request("/unread-count").then((response) => response.json() as Promise<UnreadCountsResponse>)
            ]);
            state.update((current) =>
                withStatus(
                    projectFeeds(
                        current,
                        { subscriptions, unreadCounts },
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
                timestamp: Number(item.timestampUsec)
            }));
            for (const { item, timestamp } of loaded) {
                if (Number.isFinite(timestamp)) itemTimestamps.set(item, timestamp);
            }
            return { items: loaded.map(({ item }) => item), continuation: json.continuation || undefined };
        } catch (error) {
            if (isAuthFailure(error)) handleFailure(error);
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
            await request("/mark-all-as-read", { s: streamId, ts: through });
        } catch (error) {
            if (isAuthFailure(error)) handleFailure(error);
            throw error;
        }
        state.update((current) => withMarkedRead(current, streamId, through, options.now()));
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
        runAction
    };
}
