import { decodeEntities, escapeHtml } from "../../lib/html.ts";
import { Store } from "../../lib/store.ts";
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
import { InoreaderAuthError, InoreaderOAuth, type InoreaderOAuthOptions } from "./oauth.ts";

export const INOREADER_SOURCE_ID = "inoreader";
const FEED_PREFIX = `${INOREADER_SOURCE_ID}:`;
const READ_CATEGORY = /^user\/[^/]+\/state\/com\.google\/read$/;

export interface InoreaderSourceOptions extends InoreaderOAuthOptions {
    /** Navigate the browser, used for the OAuth redirect. */
    navigate: (url: string) => void;
}

export class InoreaderRequestError extends Error {
    override name = "InoreaderRequestError";
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

const SETTINGS_DESCRIPTION = [
    "Click Connect to Inoreader, then click Authorize on the Inoreader site.",
    "To use your own Inoreader app, create one in Inoreader Preferences → Developer (Read and Write scope, no redirect URL needed) and enter its Client ID and secret. Leave both empty to use the default app."
];

/** Stream IDs of feeds with basic-auth credentials differ between the two endpoints. */
function unreadCountId(streamId: string): string {
    return streamId.replace(/(https?):\/\/(\w+):(\w+)@/, "$1://");
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

export class InoreaderSource implements Source {
    readonly id = INOREADER_SOURCE_ID;
    readonly title = "Inoreader";
    readonly homeUrl: string;
    readonly capabilities = { loadMore: true, unreadFilter: true, liveItems: false } as const;

    readonly #oauth: InoreaderOAuth;
    readonly #store: Store<SourceSnapshot>;
    /** Stream ID → the timestamp (µs) through which this browser marked the feed read. */
    readonly #readThrough = new Map<string, number>();
    /** Item → its Inoreader timestampUsec, for mark-all-as-read. */
    readonly #itemTimestamps = new WeakMap<Item, number>();
    #subscriptions?: SubscriptionsResponse;
    #unreadCounts?: UnreadCountsResponse;

    private readonly options: InoreaderSourceOptions;

    constructor(options: InoreaderSourceOptions) {
        this.options = options;
        this.#oauth = new InoreaderOAuth(options);
        this.homeUrl = options.baseUrl;
        this.#store = new Store(
            this.createSnapshot([], this.#oauth.token ? idle("Inoreader is connected.") : disconnected())
        );
    }

    getSnapshot = (): SourceSnapshot => this.#store.get();
    subscribe = (listener: () => void): (() => void) => this.#store.subscribe(listener);

    private createSnapshot(feeds: readonly Feed[], status: SourceStatus): SourceSnapshot {
        const connected = this.#oauth.token !== undefined;
        const custom = this.#oauth.customClient;
        const settings: SourceSettings = {
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
        return { connected, status, feeds, settings };
    }

    private publish(changes: { feeds?: readonly Feed[]; status?: SourceStatus }): void {
        const current = this.#store.get();
        this.#store.set(this.createSnapshot(changes.feeds ?? current.feeds, changes.status ?? current.status));
    }

    async restore(url: URL): Promise<{ consumedUrl: boolean }> {
        if (!this.#oauth.isCallback(url)) return { consumedUrl: false };
        try {
            await this.#oauth.handleCallback(url);
            this.publish({ status: idle("Inoreader connected.") });
        } catch (error) {
            this.publish({ status: failed(errorMessage(error)) });
        }
        return { consumedUrl: true };
    }

    private async request(path: string, params: Record<string, string | number | undefined> = {}): Promise<Response> {
        const url = new URL(`${this.options.baseUrl}/reader/api/0${path}`);
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        const send = async (accessToken: string) => {
            try {
                return await this.options.fetch(`${this.options.corsProxy}${url.toString()}`, {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
            } catch {
                throw new InoreaderRequestError("Could not reach Inoreader. Check your connection.", 0);
            }
        };
        const accessToken = await this.#oauth.accessToken();
        let response = await send(accessToken);
        if (response.status === 401) {
            // The token may have been revoked or expired early: refresh once.
            response = await send((await this.#oauth.refresh(accessToken)).accessToken);
        }
        if (!response.ok) {
            throw new InoreaderRequestError(`Inoreader request failed (HTTP ${response.status}).`, response.status);
        }
        return response;
    }

    private handleFailure(error: unknown): never {
        if (isAuthFailure(error)) {
            this.#oauth.clearToken();
            this.publish({
                feeds: [],
                status: { phase: "disconnected", message: `${errorMessage(error)} Open Sources to connect again.` }
            });
        } else {
            this.publish({ status: failed(errorMessage(error)) });
        }
        throw error;
    }

    async sync(): Promise<void> {
        if (!this.#oauth.token) return;
        this.publish({ status: { phase: "syncing", message: "Loading Inoreader subscriptions…" } });
        try {
            const [subscriptions, unreadCounts] = await Promise.all([
                this.request("/subscription/list").then(
                    (response) => response.json() as Promise<SubscriptionsResponse>
                ),
                this.request("/unread-count").then((response) => response.json() as Promise<UnreadCountsResponse>)
            ]);
            this.#subscriptions = subscriptions;
            this.#unreadCounts = unreadCounts;
            this.publish({ feeds: this.buildFeeds(), status: idle("Inoreader is connected.") });
        } catch (error) {
            this.handleFailure(error);
        }
    }

    private buildFeeds(): Feed[] {
        if (!this.#subscriptions || !this.#unreadCounts) return [];
        const previous = new Map(this.#store.get().feeds.map((feed) => [feed.id, feed]));
        const counts = new Map(this.#unreadCounts.unreadcounts.map((count) => [count.id, count]));
        const limit = Number(this.#unreadCounts.max) || 1000;
        const feeds: Feed[] = [];
        for (const subscription of this.#subscriptions.subscriptions) {
            const unread = counts.get(unreadCountId(subscription.id));
            // Inoreader returns no unread entry for some streams; irodr 1.x skipped them too.
            if (!unread) continue;
            const newest = Number(unread.newestItemTimestampUsec) || 0;
            const readThrough = this.#readThrough.get(subscription.id);
            // A mark-all-as-read request may not be reflected by the next count yet.
            const unreadCount = readThrough !== undefined && newest <= readThrough ? 0 : Number(unread.count) || 0;
            const feed: Feed = {
                id: `${FEED_PREFIX}${subscription.id}`,
                sourceId: this.id,
                title: subscription.title,
                category: subscription.categories[0]?.label ?? "Uncategorized",
                htmlUrl: subscription.htmlUrl,
                feedUrl: subscription.url,
                iconUrl: subscription.iconUrl || undefined,
                editUrl: `${this.options.baseUrl}/feed/${encodeURIComponent(subscription.url)}`,
                unreadCount,
                unreadCountLimit: limit,
                updatedAt: newest ? Math.floor(newest / 1000) : undefined,
                revision: String(newest)
            };
            const old = previous.get(feed.id);
            // Keep object identity for unchanged feeds so the UI skips re-rendering them.
            feeds.push(old && shallowEqual(old, feed) ? old : feed);
        }
        return feeds;
    }

    private streamId(feedId: string): string {
        if (!feedId.startsWith(FEED_PREFIX)) throw new Error(`Not an Inoreader feed: ${feedId}`);
        return feedId.slice(FEED_PREFIX.length);
    }

    async loadItems(feedId: string, options: { count: number; continuation?: string }): Promise<ItemPage> {
        const streamId = this.streamId(feedId);
        try {
            const response = await this.request(`/stream/contents/${encodeURIComponent(streamId)}`, {
                n: options.count,
                c: options.continuation
            });
            const json = (await response.json()) as StreamContentsResponse;
            const items = json.items.map((item) => this.toItem(feedId, json.id || streamId, item));
            return { items, continuation: json.continuation || undefined };
        } catch (error) {
            if (isAuthFailure(error)) this.handleFailure(error);
            throw error;
        }
    }

    private toItem(feedId: string, streamId: string, response: StreamItemResponse): Item {
        const canonical = (response.canonical ?? []).map((link) => link.href).join(",");
        // Seconds. Guard against missing values: an invalid date must not break rendering.
        const published = response.published || 0;
        const updated = response.updated || published;
        const item: Item = {
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
        const timestamp = Number(response.timestampUsec);
        if (Number.isFinite(timestamp)) this.#itemTimestamps.set(item, timestamp);
        return item;
    }

    async markRead(feedId: string, loadedItems: readonly Item[]): Promise<void> {
        const streamId = this.streamId(feedId);
        const loaded = loadedItems
            .map((item) => this.#itemTimestamps.get(item) ?? item.updatedAt * 1000)
            .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
        // Nothing was shown, so nothing is marked read.
        if (loaded.length === 0) return;
        // Through the newest loaded article: later arrivals stay unread.
        // mark-all-as-read covers articles older than `ts`, so add 1µs to include the newest.
        const through = Math.max(...loaded) + 1;
        try {
            await this.request("/mark-all-as-read", { s: streamId, ts: through });
        } catch (error) {
            if (isAuthFailure(error)) this.handleFailure(error);
            throw error;
        }
        this.#readThrough.set(streamId, Math.max(this.#readThrough.get(streamId) ?? 0, through));
        this.publish({
            feeds: this.#store
                .get()
                .feeds.map((feed) =>
                    feed.id === feedId && feed.unreadCount !== 0 ? { ...feed, unreadCount: 0 } : feed
                )
        });
    }

    async runAction(actionId: string, values: SettingValues): Promise<string> {
        switch (actionId) {
            case "connect": {
                const clientId = typeof values.clientId === "string" ? values.clientId : "";
                const clientSecret = typeof values.clientSecret === "string" ? values.clientSecret : "";
                this.#oauth.setCustomClient({ clientId, clientSecret });
                this.options.navigate(this.#oauth.authorizeUrl());
                return "Opening Inoreader authorization…";
            }
            case "disconnect":
                this.#oauth.clearToken();
                this.#subscriptions = undefined;
                this.#unreadCounts = undefined;
                this.publish({ feeds: [], status: disconnected() });
                return "Inoreader disconnected.";
            default:
                throw new Error(`Unknown action: ${actionId}`);
        }
    }
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

function shallowEqual<T extends object>(a: T, b: T): boolean {
    const keys = Object.keys(a) as (keyof T)[];
    return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}
