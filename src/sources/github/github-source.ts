import type { KeyValueStore, WriteLock } from "../../lib/kv-store.ts";
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
import {
    CONTENT_VERSION,
    GitHubApi,
    type GitHubApiOptions,
    type GitHubNotification,
    GitHubRequestError,
    isoDate,
    validRepository
} from "./github-api.ts";
import { type CachedItem, type CachedSource, type CacheSnapshot, GitHubCache } from "./github-cache.ts";

export const GITHUB_SOURCE_ID = "github-notifications";
export const GITHUB_CATEGORY = "GitHub Notifications";
const FEED_PREFIX = "github-notifications/repository/";
const ITEM_PREFIX = `source:${GITHUB_SOURCE_ID}:`;
const CREDENTIAL_KEY = `credential:${encodeURIComponent(GITHUB_SOURCE_ID)}`;
const DEFAULT_ICON = "https://github.githubassets.com/favicons/favicon.svg";
const DETAILS_CONCURRENCY = 4;

export interface GitHubSourceOptions extends GitHubApiOptions {
    /** IndexedDB `irodr-sources`: the cached inbox. */
    cache: KeyValueStore;
    /** IndexedDB `irodr-source-credentials`: the unencrypted PAT. */
    credentials: KeyValueStore;
    lock: WriteLock;
}

class GitHubSourceError extends Error {
    override name = "GitHubSourceError";
}

const LOCKED: SourceStatus = {
    phase: "disconnected",
    message: "GitHub is disconnected. Open Sources to connect your token. Stored articles remain readable."
};

const SETTINGS_DESCRIPTION = [
    "Use a classic personal access token with the notifications scope. The repo scope is also needed for private repository release bodies. On GitHub, use Watch → Custom → Releases for repositories whose release notifications you want to follow.",
    "Unread notifications of all types are grouped by repository under GitHub Notifications. Moving to another feed marks that repository's notifications read on GitHub up to the loaded timestamp, including Issue and Pull Request notifications. Shift+S skips without marking read. Other browsers see the change on their next refresh.",
    "Your token is saved unencrypted in this browser and restored automatically after reload. Scripts running on this origin, including user scripts, can access it.",
    "Each sync reloads the current unread inbox without a date cutoff. Repositories with no unread notifications disappear once you leave them. Cached article bodies, including private content, are not encrypted."
];

function failureMessage(error: unknown): string {
    if (error instanceof GitHubRequestError) {
        const hint =
            error.status === 401
                ? "Reconnect with a valid classic PAT."
                : error.status === 403
                  ? "Check the notifications scope, organization access and GitHub rate limits."
                  : "GitHub may be unavailable or rate limited.";
        return `GitHub request failed (HTTP ${error.status}). ${hint} Already loaded articles are kept.`;
    }
    if (error instanceof GitHubSourceError) return error.message;
    if (error instanceof Error && error.message.startsWith("GitHub authentication failed")) return error.message;
    return "GitHub sync failed. Check your connection and browser storage. Already loaded articles are kept.";
}

function repositoryOfFeed(feedId: string): string {
    const repository = feedId.startsWith(FEED_PREFIX)
        ? validRepository(decodeURIComponent(feedId.slice(FEED_PREFIX.length)))
        : undefined;
    if (!repository) throw new Error(`Not a GitHub repository feed: ${feedId}`);
    return repository;
}

export function githubFeedId(repository: string): string {
    return `${FEED_PREFIX}${encodeURIComponent(repository)}`;
}

function itemId(externalId: string): string {
    return `${ITEM_PREFIX}${encodeURIComponent(externalId)}`;
}

function externalIdOf(id: string): string | undefined {
    return id.startsWith(ITEM_PREFIX) ? decodeURIComponent(id.slice(ITEM_PREFIX.length)) : undefined;
}

/** Whether a repository-wide read through `readThrough` covers `item`. */
function isCoveredByRead(item: CachedItem, readThrough: ReadonlyMap<string, number>): boolean {
    const repository = validRepository(item.metadata?.repository);
    const cutoff = repository ? readThrough.get(repository) : undefined;
    const updated = Date.parse(item.updatedAt ?? "");
    return cutoff !== undefined && Number.isFinite(updated) && updated <= cutoff;
}

export class GitHubSource implements Source {
    readonly id = GITHUB_SOURCE_ID;
    readonly title = "GitHub Notifications";
    readonly homeUrl: string;
    readonly capabilities = { loadMore: false, unreadFilter: false, liveItems: true } as const;

    readonly #api: GitHubApi;
    readonly #cache: GitHubCache;
    readonly #store: Store<SourceSnapshot>;
    #token?: string;
    #savedCredential = false;
    #generation = 0;
    #retryAfter = 0;
    #syncing?: { generation: number; promise: Promise<void>; controller: AbortController };
    #connecting?: AbortController;
    #readsDuringSync = new Map<string, number>();
    readonly #writeRequests = new Set<AbortController>();
    #status: SourceStatus = LOCKED;
    /** Repositories in first-seen order. Read ones stay (with 0 unread) until reload, like read RSS feeds. */
    #repositories: string[] = [];
    #items = new Map<string, readonly Item[]>();
    private readonly options: GitHubSourceOptions;

    constructor(options: GitHubSourceOptions) {
        this.options = options;
        this.#api = new GitHubApi(options);
        this.#cache = new GitHubCache(options.cache, options.lock);
        this.homeUrl = `${options.webBaseUrl.replace(/\/$/, "")}/notifications`;
        this.#store = new Store(this.createSnapshot([]));
    }

    getSnapshot = (): SourceSnapshot => this.#store.get();
    subscribe = (listener: () => void): (() => void) => this.#store.subscribe(listener);

    private get cachedSource(): CachedSource | undefined {
        return this.#cache.snapshot.sources.find((source) => source.id === this.id);
    }

    private createSnapshot(feeds: readonly Feed[]): SourceSnapshot {
        const source = this.cachedSource;
        const settings: SourceSettings = {
            description: SETTINGS_DESCRIPTION,
            fields: [
                ...(source
                    ? [
                          {
                              name: "releaseOnly",
                              label: "Show only Release notifications (display only; repository read still includes all types)",
                              type: "checkbox" as const,
                              value: source.config.releaseOnly === true,
                              applyOnChange: true
                          }
                      ]
                    : []),
                {
                    name: "token",
                    label: "Classic personal access token",
                    type: "password",
                    value: "",
                    transient: true
                }
            ],
            actions: [
                { id: "connect", label: "Connect GitHub", primary: true, requires: ["token"] },
                ...(this.#savedCredential || this.#token
                    ? [{ id: "disconnect", label: "Disconnect and forget token" }]
                    : [])
            ]
        };
        return { connected: this.#token !== undefined, status: this.#status, feeds, settings };
    }

    private publish(): void {
        this.#store.set(this.createSnapshot(this.#store.get().feeds));
    }

    private updateStatus(status: SourceStatus): void {
        this.#status = status;
        this.publish();
    }

    /** Rebuild repository feeds from the cache. */
    private project(): void {
        const source = this.cachedSource;
        if (!source) {
            this.#items = new Map();
            this.#store.set(this.createSnapshot([]));
            return;
        }
        const releaseOnly = source.config.releaseOnly === true;
        const groups = new Map<string, CachedItem[]>();
        // Repositories hidden by the display filter still have unread notifications.
        const hidden = new Set<string>();
        for (const item of this.#cache.snapshot.items) {
            if (item.sourceId !== this.id || item.metadata?.githubUnread === false) continue;
            const repository = validRepository(item.metadata?.repository);
            if (!repository) continue;
            if (!this.#repositories.includes(repository)) this.#repositories.push(repository);
            if (releaseOnly && item.metadata?.type !== "Release") {
                hidden.add(repository);
                continue;
            }
            groups.set(repository, [...(groups.get(repository) ?? []), item]);
        }
        const previousFeeds = new Map(this.#store.get().feeds.map((feed) => [feed.id, feed]));
        const previousItems = this.#items;
        const syncedAt = Date.parse(source.lastSyncedAt ?? "") || undefined;
        const feeds: Feed[] = [];
        const itemsByFeed = new Map<string, readonly Item[]>();
        for (const repository of this.#repositories) {
            const cached = groups.get(repository) ?? [];
            if (cached.length === 0 && hidden.has(repository)) continue;
            const id = githubFeedId(repository);
            const old = new Map((previousItems.get(id) ?? []).map((item) => [item.id, item]));
            const items = cached
                .map((item) => toItem(id, repository, item))
                .map((item) => {
                    const previous = old.get(item.id);
                    return previous && shallowEqual(previous, item) ? previous : item;
                })
                .sort((a, b) => b.updatedAt - a.updatedAt);
            itemsByFeed.set(id, items);
            const feed: Feed = {
                id,
                sourceId: this.id,
                title: repository,
                category: GITHUB_CATEGORY,
                htmlUrl: `${this.options.webBaseUrl.replace(/\/$/, "")}/${repository}`,
                iconUrl: source.config.iconUrl ?? DEFAULT_ICON,
                unreadCount: items.length,
                updatedAt: syncedAt,
                revision: items
                    .map((item) => `${item.id}@${item.updatedAt}:${item.url}:${item.contentHtml.length}`)
                    .join(",")
            };
            const previous = previousFeeds.get(id);
            feeds.push(previous && shallowEqual(previous, feed) ? previous : feed);
        }
        this.#items = itemsByFeed;
        this.#store.set(this.createSnapshot(feeds));
    }

    async restore(): Promise<{ consumedUrl: boolean }> {
        const generation = this.#generation;
        try {
            await this.#cache.load();
            this.project();
        } catch {
            this.updateStatus({
                phase: "error",
                message: "Could not read the cached GitHub inbox from browser storage."
            });
        }
        try {
            const saved = await this.options.credentials.get<{ version?: number; token?: unknown }>(CREDENTIAL_KEY);
            // irodr 1.x also stored passphrase-encrypted tokens; those cannot be restored.
            const token = saved?.version === 2 && typeof saved.token === "string" ? saved.token.trim() : "";
            if (token && generation === this.#generation && !this.#token) {
                this.#token = token;
                this.#savedCredential = true;
                this.updateStatus({ phase: "idle", message: "Saved GitHub token restored. Ready to sync." });
            }
        } catch {
            if (generation === this.#generation) {
                this.updateStatus({
                    phase: "error",
                    message: "Could not load the saved GitHub token. Open Sources to reconnect."
                });
            }
        }
        return { consumedUrl: false };
    }

    /** Stop syncing and forget the in-memory token. The cached inbox stays readable. */
    lock(): void {
        this.#generation++;
        this.#token = undefined;
        this.#connecting?.abort();
        this.#syncing?.controller.abort();
        for (const controller of this.#writeRequests) controller.abort();
        this.updateStatus(LOCKED);
    }

    async connect(token: string): Promise<void> {
        // A new connection replaces any previous session, including in-flight work.
        this.lock();
        const generation = this.#generation;
        const controller = new AbortController();
        this.#connecting = controller;
        this.updateStatus({ phase: "syncing", message: "Connecting to GitHub…" });
        const cancelled = () => {
            if (generation !== this.#generation) throw new GitHubSourceError("GitHub connection cancelled.");
        };
        try {
            // Bind the local inbox to an account, not a PAT: rotating the PAT keeps the cache,
            // while another account must not mix private inboxes.
            const user = await this.#api.getUser(token, controller.signal);
            await this.#cache.load();
            cancelled();
            const existing = this.cachedSource;
            if (existing && existing.config.accountId !== user.id) {
                throw new GitHubSourceError(
                    "This browser inbox belongs to another GitHub account. Use a separate browser profile."
                );
            }
            if (!existing) {
                await this.#cache.write((snapshot) => {
                    snapshot.sources.push({
                        id: this.id,
                        adapterType: GITHUB_SOURCE_ID,
                        config: {
                            title: this.title,
                            accountId: user.id,
                            url: this.homeUrl,
                            iconUrl: DEFAULT_ICON,
                            category: GITHUB_CATEGORY
                        }
                    });
                });
            }
            cancelled();
            this.#token = token;
            this.#retryAfter = 0;
            this.#status = { phase: "idle", message: "GitHub connected. Ready to sync." };
            this.project();
        } catch (error) {
            if (generation === this.#generation) this.updateStatus({ phase: "error", message: failureMessage(error) });
            throw error;
        } finally {
            if (this.#connecting === controller) this.#connecting = undefined;
        }
    }

    sync(): Promise<void> {
        if (this.#syncing?.generation === this.#generation) return this.#syncing.promise;
        if (!this.#token) {
            if (this.#status.phase !== "error") this.updateStatus(LOCKED);
            return Promise.resolve();
        }
        // Back off after failures; keep the failure explanation instead of claiming success.
        if (this.options.now() < this.#retryAfter) return Promise.resolve();
        const token = this.#token;
        const generation = this.#generation;
        const controller = new AbortController();
        const readsDuringSync = new Map<string, number>();
        this.#readsDuringSync = readsDuringSync;
        const cancelled = () => {
            if (generation !== this.#generation) throw new GitHubSourceError("GitHub sync cancelled.");
        };
        const unread = (items: CachedItem[]) => items.filter((item) => !isCoveredByRead(item, readsDuringSync));
        // Checkpoint items without claiming a complete sync: a retry starts from the previous cursor.
        const saveItems = async (items: CachedItem[]) => {
            cancelled();
            const incoming = unread(items);
            if (incoming.length === 0) return;
            await this.#cache.write((snapshot) => upsertItems(snapshot, this.id, incoming));
            if (generation === this.#generation) this.project();
        };
        const promise = (async () => {
            try {
                await this.#cache.load();
                cancelled();
                const source = this.cachedSource;
                if (!source) return;
                const nextPollAt = Date.parse(source.cursor?.nextPollAt ?? "");
                if (nextPollAt > this.options.now()) {
                    this.updateStatus({
                        phase: "waiting",
                        message: `GitHub polling interval: next request after ${new Date(nextPollAt).toLocaleTimeString()}.`
                    });
                    return;
                }
                this.updateStatus({ phase: "syncing", message: "Loading GitHub notifications…" });
                const existing = new Map(
                    this.#cache.snapshot.items
                        .filter((item) => item.sourceId === this.id)
                        .map((item) => [item.externalId, item])
                );
                const items = new Map<string, CachedItem>();
                const pending = new Map<string, { notification: GitHubNotification; item: CachedItem }>();
                const visited = new Set<string>();
                let next: string | undefined = this.#api.firstNotificationsUrl();
                let pollSeconds = 60;
                while (next) {
                    if (visited.has(next)) throw new Error("Invalid GitHub pagination.");
                    visited.add(next);
                    const page = await this.#api.notificationPage(next, token, controller.signal);
                    pollSeconds = Math.max(pollSeconds, page.pollSeconds ?? 0);
                    const pageItems: CachedItem[] = [];
                    for (const notification of page.notifications) {
                        if (notification.unread === false) continue;
                        const base = this.baseItem(notification);
                        const cached = existing.get(base.externalId);
                        const reusable =
                            (cached?.metadata?.detailsResolved === true ||
                                cached?.metadata?.releaseResolved === true) &&
                            cached.metadata.contentVersion === CONTENT_VERSION &&
                            cached.metadata.type === base.metadata?.type &&
                            base.updatedAt !== undefined &&
                            cached.updatedAt === base.updatedAt;
                        // Keep previously loaded details visible until refreshed details arrive.
                        const item: CachedItem = cached
                            ? {
                                  ...cached,
                                  ...base,
                                  url: cached.url || base.url,
                                  content: cached.content,
                                  publishedAt: cached.publishedAt,
                                  metadata: {
                                      ...base.metadata,
                                      contentVersion: cached.metadata?.contentVersion,
                                      detailsResolved: reusable
                                  }
                              }
                            : base;
                        items.set(item.externalId, item);
                        pageItems.push(item);
                        if (reusable) pending.delete(item.externalId);
                        else pending.set(item.externalId, { notification, item });
                    }
                    this.updateStatus({
                        phase: "syncing",
                        message: "Loading GitHub notification pages… Articles appear as they arrive."
                    });
                    // Titles appear page by page, before details are resolved.
                    await saveItems(pageItems);
                    next = page.next;
                }
                // Absence means read only after every page succeeded. Body enrichment is
                // optional and must not block cross-browser read reconciliation.
                cancelled();
                const cursor = { nextPollAt: new Date(this.options.now() + pollSeconds * 1000).toISOString() };
                const complete = unread([...items.values()]);
                await this.#cache.write((snapshot) => {
                    const record = snapshot.sources.find((entry) => entry.id === this.id);
                    if (!record) throw new GitHubSourceError("GitHub source was removed.");
                    // Notifications absent from a complete unread snapshot were read elsewhere.
                    const retained = new Set(complete.map((item) => item.externalId));
                    snapshot.items = snapshot.items.filter(
                        (item) => item.sourceId !== this.id || retained.has(item.externalId)
                    );
                    upsertItems(snapshot, this.id, complete);
                    record.cursor = cursor;
                    record.lastSyncedAt = new Date(this.options.now()).toISOString();
                });
                if (generation === this.#generation) this.project();
                // Resolve bodies in groups, checkpointing every 100 successes (or on completion/failure).
                const unresolved = [...pending.values()];
                let resolved = items.size - unresolved.length;
                let checkpoint: CachedItem[] = [];
                for (let offset = 0; offset < unresolved.length; offset += DETAILS_CONCURRENCY) {
                    this.updateStatus({
                        phase: "syncing",
                        message: `Loading notification details (${resolved}/${items.size})…`
                    });
                    const results = await Promise.allSettled(
                        unresolved
                            .slice(offset, offset + DETAILS_CONCURRENCY)
                            .map(({ notification, item }) =>
                                this.resolveItem(notification, item, token, controller.signal)
                            )
                    );
                    let failure: PromiseRejectedResult | undefined;
                    for (const result of results) {
                        if (result.status === "fulfilled") {
                            items.set(result.value.externalId, result.value);
                            checkpoint.push(result.value);
                            resolved++;
                        } else {
                            failure ??= result;
                        }
                    }
                    if (checkpoint.length >= 100 || failure || offset + DETAILS_CONCURRENCY >= unresolved.length) {
                        await saveItems(checkpoint);
                        checkpoint = [];
                    }
                    if (failure) throw failure.reason;
                }
                cancelled();
                const count = this.#cache.snapshot.items.filter((item) => item.sourceId === this.id).length;
                this.updateStatus({
                    phase: "idle",
                    message:
                        count > 0
                            ? `GitHub sync complete: ${count} unread notifications.`
                            : "GitHub sync complete: no unread notifications."
                });
            } catch (error) {
                if (generation !== this.#generation) return;
                // Avoid a tight retry loop on network, authentication or rate-limit failures.
                this.#retryAfter =
                    this.options.now() + (error instanceof GitHubRequestError ? error.retryAfterMs : 5 * 60 * 1000);
                this.updateStatus({
                    phase: "error",
                    message: `${failureMessage(error)} Retry after ${new Date(this.#retryAfter).toLocaleTimeString()}.`
                });
                throw error;
            }
        })().finally(() => {
            if (this.#syncing?.generation === generation) this.#syncing = undefined;
        });
        this.#syncing = { generation, promise, controller };
        return promise;
    }

    private baseItem(notification: GitHubNotification): CachedItem {
        const repository = validRepository(notification.repository?.full_name);
        const type = typeof notification.subject.type === "string" ? notification.subject.type : "Notification";
        const web = this.options.webBaseUrl.replace(/\/$/, "");
        return {
            externalId: notification.id,
            sourceId: this.id,
            title: notification.subject.title,
            url: repository ? `${web}/${repository}${type === "Release" ? "/releases" : ""}` : undefined,
            updatedAt: isoDate(notification.updated_at),
            metadata: {
                type,
                repository,
                ...(typeof notification.unread === "boolean" ? { githubUnread: notification.unread } : {})
            }
        };
    }

    private async resolveItem(
        notification: GitHubNotification,
        base: CachedItem,
        token: string,
        signal: AbortSignal
    ): Promise<CachedItem> {
        const details = await this.#api.details(notification, token, signal);
        return {
            ...base,
            url: details.url ?? base.url,
            content: details.content ?? base.content,
            publishedAt: details.publishedAt ?? base.publishedAt,
            metadata: { ...base.metadata, detailsResolved: details.resolved, contentVersion: CONTENT_VERSION }
        };
    }

    async loadItems(feedId: string): Promise<ItemPage> {
        repositoryOfFeed(feedId);
        return { items: this.#items.get(feedId) ?? [] };
    }

    /** One PUT per repository; every notification type up to the cutoff is acknowledged. */
    async markRead(feedId: string, loadedItems: readonly Item[]): Promise<void> {
        if (!this.#token) throw new GitHubSourceError("Connect GitHub before marking notifications read.");
        await this.#cache.load();
        const repository = repositoryOfFeed(feedId);
        const wanted = new Set(loadedItems.map((item) => externalIdOf(item.id)));
        // Notifications removed meanwhile (read in another browser) need no request.
        const stillUnread = this.#cache.snapshot.items.some(
            (item) => item.sourceId === this.id && wanted.has(item.externalId)
        );
        if (!stillUnread) return;
        // Freeze the cutoff at the newest loaded notification: later arrivals stay unread.
        const cutoff = Math.max(...loadedItems.map((item) => item.updatedAt));
        if (!Number.isFinite(cutoff) || cutoff <= 0) {
            throw new GitHubSourceError("Cannot safely mark a repository read without its notification timestamp.");
        }
        const token = this.#token;
        const generation = this.#generation;
        const controller = new AbortController();
        this.#writeRequests.add(controller);
        try {
            const finished = await this.#api.markRepositoryRead(
                repository,
                new Date(cutoff).toISOString(),
                token,
                controller.signal
            );
            if (generation !== this.#generation) throw new GitHubSourceError("GitHub read operation cancelled.");
            if (finished) {
                const readThrough = new Map([[repository, cutoff]]);
                this.#readsDuringSync.set(repository, Math.max(this.#readsDuringSync.get(repository) ?? 0, cutoff));
                // Compare with the latest stored timestamps: an update that arrived meanwhile stays.
                await this.#cache.write((snapshot) => {
                    snapshot.items = snapshot.items.filter(
                        (item) => item.sourceId !== this.id || !isCoveredByRead(item, readThrough)
                    );
                });
                if (generation === this.#generation) this.project();
            } else {
                this.updateStatus({
                    phase: "waiting",
                    message:
                        "GitHub is marking repository notifications read in the background. The next refresh will confirm completion."
                });
            }
        } catch (error) {
            if (generation === this.#generation) {
                this.updateStatus({
                    phase: "error",
                    message: `${failureMessage(error)} Failed notifications remain unread.`
                });
            }
            throw error;
        } finally {
            this.#writeRequests.delete(controller);
        }
    }

    async runAction(actionId: string, values: SettingValues): Promise<string> {
        switch (actionId) {
            case "connect": {
                const token = typeof values.token === "string" ? values.token.trim() : "";
                if (!token) throw new GitHubSourceError("Enter a classic personal access token.");
                await this.connect(token);
                await this.options.credentials.set(CREDENTIAL_KEY, { version: 2, token });
                this.#savedCredential = true;
                this.publish();
                // Articles appear page by page; failures are reported through the status.
                this.sync().catch(() => undefined);
                return "GitHub connected.";
            }
            case "disconnect":
                this.lock();
                await this.options.credentials.delete(CREDENTIAL_KEY);
                this.#savedCredential = false;
                this.publish();
                return "GitHub disconnected and saved token removed.";
            case "setting:releaseOnly": {
                const releaseOnly = values.releaseOnly === true;
                await this.#cache.write((snapshot) => {
                    const source = snapshot.sources.find((entry) => entry.id === this.id);
                    if (!source) throw new GitHubSourceError("Connect GitHub first.");
                    source.config = { ...source.config, releaseOnly };
                });
                this.project();
                return "Display filter saved.";
            }
            default:
                throw new Error(`Unknown action: ${actionId}`);
        }
    }
}

function upsertItems(snapshot: CacheSnapshot, sourceId: string, items: readonly CachedItem[]): void {
    const indices = new Map<string, number>();
    snapshot.items.forEach((item, index) => {
        if (item.sourceId === sourceId) indices.set(item.externalId, index);
    });
    for (const item of items) {
        const index = indices.get(item.externalId);
        if (index === undefined) {
            indices.set(item.externalId, snapshot.items.length);
            snapshot.items.push(structuredClone(item));
        } else {
            snapshot.items[index] = structuredClone(item);
        }
    }
}

function toItem(feedId: string, repository: string, item: CachedItem): Item {
    const published = Date.parse(item.publishedAt ?? item.updatedAt ?? "") || 0;
    const updated = Date.parse(item.updatedAt ?? item.publishedAt ?? "") || published;
    return {
        id: itemId(item.externalId),
        feedId,
        title: item.title,
        url: item.url ?? "",
        author: repository,
        contentHtml: item.content ?? "",
        publishedAt: published,
        updatedAt: updated,
        unread: true
    };
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
    const keys = Object.keys(a) as (keyof T)[];
    return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}
