import { shallowEqual } from "../../lib/equal.ts";
import type { KeyValueStore, WriteLock } from "../../lib/kv-store.ts";
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
import {
    CONTENT_VERSION,
    createGitHubApi,
    type GitHubApiOptions,
    type GitHubNotification,
    GitHubRequestError,
    isoDate,
    type NotificationDetails,
    validRepository
} from "./github-api.ts";
import {
    type CachedItem,
    type CacheSnapshot,
    cachedSource,
    createGitHubCache,
    isCoveredByRead,
    readThroughOf,
    withInbox,
    withItems,
    withoutRead,
    withSource,
    withSourceChange
} from "./github-cache.ts";

export const GITHUB_SOURCE_ID = "github-notifications";
export const GITHUB_CATEGORY = "GitHub Notifications";
const TITLE = "GitHub Notifications";
const FEED_PREFIX = "github-notifications/repository/";
const ITEM_PREFIX = `source:${GITHUB_SOURCE_ID}:`;
const CREDENTIAL_KEY = `credential:${encodeURIComponent(GITHUB_SOURCE_ID)}`;
const DEFAULT_ICON = "https://github.githubassets.com/favicons/favicon.svg";
const DETAILS_CONCURRENCY = 4;
const MARK_READ_CONCURRENCY = 4;
const CAPABILITIES = { loadMore: false, unreadFilter: false, liveItems: true } as const;

export interface GitHubSourceOptions extends GitHubApiOptions {
    /** IndexedDB `irodr-sources`: the cached inbox. */
    readonly cache: KeyValueStore;
    /** IndexedDB `irodr-source-credentials`: the unencrypted PAT. */
    readonly credentials: KeyValueStore;
    readonly lock: WriteLock;
}

/** GitHub Notifications as a `Source`. It ignores the restore URL and returns a repository's items at once. */
export interface GitHubSource extends Source {
    readonly restore: () => Promise<{ consumedUrl: boolean }>;
    readonly loadItems: (feedId: string) => Promise<ItemPage>;
    /** Check `token` and bind the cached inbox to its account. Replaces the current session. */
    readonly connect: (token: string) => Promise<void>;
    /** Stop syncing and forget the in-memory token. The cached inbox stays readable. */
    readonly lock: () => void;
}

class GitHubSourceError extends Error {
    override name = "GitHubSourceError";
}

const LOCKED: SourceStatus = {
    phase: "disconnected",
    message: "GitHub is disconnected. Open Sources to connect your token. Stored articles remain readable."
};

const SETTINGS_DESCRIPTION = [
    "Use a classic personal access token with the notifications scope; the links below open GitHub's token form with the scopes selected. The repo scope is also needed for private repository release bodies. On GitHub, use Watch → Custom → Releases for repositories whose release notifications you want to follow.",
    "Unread notifications of all types are grouped by repository under GitHub Notifications. Moving to another feed marks each of that repository's notifications up to the loaded timestamp read on GitHub, including Issue and Pull Request notifications. Shift+S skips without marking read. Other browsers see the change on their next refresh.",
    "Your token is saved unencrypted in this browser and restored automatically after reload. Scripts running on this origin, including user scripts, can access it.",
    "Each sync reloads the current unread inbox without a date cutoff. Repositories with no unread notifications disappear once you leave them. Cached article bodies, including private content, are not encrypted."
];

/** The state of a GitHub source. Every change replaces it. */
export interface GitHubState {
    /** The token of the current session. Never part of feeds, items or the cache. */
    readonly token: string | undefined;
    /** Whether the credential store holds a token. */
    readonly savedCredential: boolean;
    /** Advanced by `lock()`: work started in an earlier generation is cancelled. */
    readonly generation: number;
    /** Epoch milliseconds before which `sync()` does not call GitHub again after a failure. */
    readonly retryAfter: number;
    readonly status: SourceStatus;
    /** Repositories in first-seen order. Read ones stay (with 0 unread) until reload, like read RSS feeds. */
    readonly repositories: ReadonlySet<string>;
    readonly feeds: readonly Feed[];
    /** Items by feed ID. */
    readonly items: ReadonlyMap<string, readonly Item[]>;
    /**
     * For each running sync, by generation: notifications marked read since it started, with the `updated_at`
     * they were read through. The sync filters its writes with them, so it cannot bring back read notifications.
     */
    readonly readsDuringSync: ReadonlyMap<number, ReadonlyMap<string, number>>;
}

export const INITIAL_STATE: GitHubState = {
    token: undefined,
    savedCredential: false,
    generation: 0,
    retryAfter: 0,
    status: LOCKED,
    repositories: new Set(),
    feeds: [],
    items: new Map(),
    readsDuringSync: new Map()
};

/** A notification of the unread inbox, merged into its cached item. */
export interface SyncEntry {
    readonly notification: GitHubNotification;
    readonly item: CachedItem;
    /** The cached details are current: they are not requested again. */
    readonly reusable: boolean;
}

interface LoadedPage {
    readonly entries: readonly SyncEntry[];
    /** From X-Poll-Interval, or 0. */
    readonly pollSeconds: number;
}

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

/**
 * GitHub's classic token form with `scopes` selected. GitHub documents pre-filled forms only for fine-grained
 * tokens, which the Notifications API does not accept; this classic form URL is the one Composer uses too.
 */
function tokenFormUrl(web: string, scopes: readonly string[]): string {
    return `${web}/settings/tokens/new?scopes=${scopes.join(",")}&description=irodr`;
}

/** The settings form. The display filter appears once an account is bound (`releaseOnly` is defined). */
function sourceSettings(releaseOnly: boolean | undefined, disconnectable: boolean, web: string): SourceSettings {
    return {
        description: SETTINGS_DESCRIPTION,
        links: [
            { label: "Create a token (notifications scope)", href: tokenFormUrl(web, ["notifications"]) },
            {
                label: "Create a token for private repositories too (notifications and repo scopes)",
                href: tokenFormUrl(web, ["notifications", "repo"])
            }
        ],
        fields: [
            ...(releaseOnly === undefined
                ? []
                : [
                      {
                          name: "releaseOnly",
                          label: "Show only Release notifications (display only; repository read still includes all types)",
                          type: "checkbox" as const,
                          value: releaseOnly,
                          applyOnChange: true
                      }
                  ]),
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
            ...(disconnectable ? [{ id: "disconnect", label: "Disconnect and forget token" }] : [])
        ]
    };
}

/** Forget the token and advance the generation, cancelling in-flight work. */
function locked(state: GitHubState): GitHubState {
    return { ...state, generation: state.generation + 1, token: undefined, status: LOCKED };
}

/**
 * Rebuild repository feeds from the cache. `web` is the GitHub web origin without a trailing slash.
 * Unchanged feeds and items stay the same objects, so the reader keeps them.
 */
export function projectFeeds(state: GitHubState, snapshot: CacheSnapshot, web: string): GitHubState {
    const source = cachedSource(snapshot, GITHUB_SOURCE_ID);
    if (!source) return { ...state, feeds: [], items: new Map() };
    const releaseOnly = source.config.releaseOnly === true;
    const unread = snapshot.items.flatMap((item) => {
        if (item.sourceId !== GITHUB_SOURCE_ID || item.metadata?.githubUnread === false) return [];
        const repository = validRepository(item.metadata?.repository);
        return repository ? [{ repository, item }] : [];
    });
    const repositories = new Set([...state.repositories, ...unread.map((entry) => entry.repository)]);
    const shown = (entry: { item: CachedItem }) => !releaseOnly || entry.item.metadata?.type === "Release";
    // Repositories hidden by the display filter still have unread notifications.
    const hidden = new Set(unread.filter((entry) => !shown(entry)).map((entry) => entry.repository));
    const groups = Map.groupBy(unread.filter(shown), (entry) => entry.repository);
    const previousFeeds = new Map(state.feeds.map((feed) => [feed.id, feed]));
    const syncedAt = Date.parse(source.lastSyncedAt ?? "") || undefined;
    const projected = [...repositories].flatMap((repository) => {
        const cached = groups.get(repository) ?? [];
        if (cached.length === 0 && hidden.has(repository)) return [];
        const id = githubFeedId(repository);
        const old = new Map((state.items.get(id) ?? []).map((item) => [item.id, item]));
        const items = cached
            .map((entry) => toItem(id, repository, entry.item))
            .map((item) => {
                const previous = old.get(item.id);
                return previous && shallowEqual(previous, item) ? previous : item;
            })
            .toSorted((a, b) => b.updatedAt - a.updatedAt);
        const feed: Feed = {
            id,
            sourceId: GITHUB_SOURCE_ID,
            title: repository,
            category: GITHUB_CATEGORY,
            htmlUrl: `${web}/${repository}`,
            iconUrl: source.config.iconUrl ?? DEFAULT_ICON,
            unreadCount: items.length,
            updatedAt: syncedAt,
            revision: items
                .map((item) => `${item.id}@${item.updatedAt}:${item.url}:${item.contentHtml.length}`)
                .join(",")
        };
        const previous = previousFeeds.get(id);
        return [{ feed: previous && shallowEqual(previous, feed) ? previous : feed, items }];
    });
    return {
        ...state,
        repositories,
        feeds: projected.map((entry) => entry.feed),
        items: new Map(projected.map((entry) => [entry.feed.id, entry.items]))
    };
}

/** Start recording repositories marked read while the sync of `generation` runs. */
export function withSyncStarted(state: GitHubState, generation: number): GitHubState {
    return {
        ...state,
        readsDuringSync: new Map<number, ReadonlyMap<string, number>>([
            ...state.readsDuringSync,
            [generation, new Map()]
        ])
    };
}

/** Stop recording reads for the sync of `generation`, which has settled. */
export function withSyncFinished(state: GitHubState, generation: number): GitHubState {
    return {
        ...state,
        readsDuringSync: new Map([...state.readsDuringSync].filter(([running]) => running !== generation))
    };
}

/** Record that GitHub marked notifications read through `readThrough` (external ID → epoch ms), for every running sync. */
export function withThreadsRead(state: GitHubState, readThrough: ReadonlyMap<string, number>): GitHubState {
    return {
        ...state,
        readsDuringSync: new Map(
            [...state.readsDuringSync].map(([generation, reads]) => [
                generation,
                new Map([
                    ...reads,
                    ...[...readThrough].map(([id, updated]) => [id, Math.max(reads.get(id) ?? 0, updated)] as const)
                ])
            ])
        )
    };
}

/** `items` without those that a read during the sync of `generation` covers. */
export function unreadDuringSync(
    state: GitHubState,
    generation: number,
    items: readonly CachedItem[]
): readonly CachedItem[] {
    const reads = state.readsDuringSync.get(generation);
    return reads ? items.filter((item) => !isCoveredByRead(item, reads)) : items;
}

function withSyncFailure(state: GitHubState, error: unknown, now: number): GitHubState {
    // Avoid a tight retry loop on network, authentication or rate-limit failures.
    const retryAfter = now + (error instanceof GitHubRequestError ? error.retryAfterMs : 5 * 60 * 1000);
    return {
        ...state,
        retryAfter,
        status: {
            phase: "error",
            message: `${failureMessage(error)} Retry after ${new Date(retryAfter).toLocaleTimeString()}.`
        }
    };
}

function baseItem(notification: GitHubNotification, web: string): CachedItem {
    const repository = validRepository(notification.repository?.full_name);
    const type = typeof notification.subject.type === "string" ? notification.subject.type : "Notification";
    return {
        externalId: notification.id,
        sourceId: GITHUB_SOURCE_ID,
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

/**
 * Merge `notification` into its cached item. The cached details are reused only when they were resolved
 * with the current content version, for the same type and `updated_at`.
 */
export function syncEntry(notification: GitHubNotification, cached: CachedItem | undefined, web: string): SyncEntry {
    const base = baseItem(notification, web);
    const reusable =
        (cached?.metadata?.detailsResolved === true || cached?.metadata?.releaseResolved === true) &&
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
    return { notification, item, reusable };
}

function withDetails(item: CachedItem, details: NotificationDetails): CachedItem {
    return {
        ...item,
        url: details.url ?? item.url,
        content: details.content ?? item.content,
        publishedAt: details.publishedAt ?? item.publishedAt,
        metadata: { ...item.metadata, detailsResolved: details.resolved, contentVersion: CONTENT_VERSION }
    };
}

/**
 * The `last_read_at` for marking `loadedItems` read, in epoch milliseconds: the newest of them as loaded,
 * so later arrivals stay unread. Undefined when none of them is cached any more (read in another browser);
 * not a positive finite number when no timestamp is safe.
 */
export function readCutoff(snapshot: CacheSnapshot, loadedItems: readonly Item[]): number | undefined {
    const wanted = new Set(loadedItems.map((item) => externalIdOf(item.id)));
    const cached = snapshot.items.filter((item) => item.sourceId === GITHUB_SOURCE_ID && wanted.has(item.externalId));
    if (cached.length === 0) return undefined;
    // Only GitHub's own `updated_at` is a safe `last_read_at`, not the publish-date fallback.
    const timestamped = new Set<string | undefined>(
        cached.filter((item) => Number.isFinite(Date.parse(item.updatedAt ?? ""))).map((item) => item.externalId)
    );
    return Math.max(
        ...loadedItems.filter((item) => timestamped.has(externalIdOf(item.id))).map((item) => item.updatedAt)
    );
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

export function createGitHubSource(options: GitHubSourceOptions): GitHubSource {
    const api = createGitHubApi(options);
    const cache = createGitHubCache(options.cache, options.lock);
    const web = options.webBaseUrl.replace(/\/$/, "");
    const homeUrl = `${web}/notifications`;
    const state = createStore(INITIAL_STATE);
    // Runtime handles: the running sync of each generation, shared by callers,
    // and the controllers of in-flight requests, aborted by lock().
    const syncs = new Map<number, Promise<void>>();
    const requests = new Set<AbortController>();
    // One settings form per variant, so an unchanged form keeps the published snapshot.
    const forms = new Map<string, SourceSettings>();

    const settingsOf = (current: GitHubState): SourceSettings => {
        const source = cachedSource(cache.snapshot(), GITHUB_SOURCE_ID);
        const releaseOnly = source ? source.config.releaseOnly === true : undefined;
        const disconnectable = current.savedCredential || current.token !== undefined;
        const key = `${releaseOnly}:${disconnectable}`;
        const form = forms.get(key) ?? sourceSettings(releaseOnly, disconnectable, web);
        forms.set(key, form);
        return form;
    };
    const snapshotOf = (current: GitHubState): SourceSnapshot => ({
        connected: current.token !== undefined,
        status: current.status,
        feeds: current.feeds,
        settings: settingsOf(current)
    });
    const view = createStore(snapshotOf(state.get()));
    // Publish what the reader sees. Internal changes, such as reads during a sync, keep the snapshot.
    state.subscribe(() =>
        view.update((previous) => {
            const next = snapshotOf(state.get());
            return shallowEqual(previous, next) ? previous : next;
        })
    );

    const isCurrent = (generation: number): boolean => state.get().generation === generation;
    const updateStatus = (status: SourceStatus): void => state.update((current) => ({ ...current, status }));
    const project = (): void => state.update((current) => projectFeeds(current, cache.snapshot(), web));

    const restore = async (): Promise<{ consumedUrl: boolean }> => {
        const { generation } = state.get();
        try {
            await cache.load();
            project();
        } catch {
            updateStatus({
                phase: "error",
                message: "Could not read the cached GitHub inbox from browser storage."
            });
        }
        try {
            const saved = await options.credentials.get<{ version?: number; token?: unknown }>(CREDENTIAL_KEY);
            // irodr 1.x also stored passphrase-encrypted tokens; those cannot be restored.
            const token = saved?.version === 2 && typeof saved.token === "string" ? saved.token.trim() : "";
            if (token && isCurrent(generation) && !state.get().token) {
                state.update((current) => ({
                    ...current,
                    token,
                    savedCredential: true,
                    status: { phase: "idle", message: "Saved GitHub token restored. Ready to sync." }
                }));
            }
        } catch {
            if (isCurrent(generation)) {
                updateStatus({
                    phase: "error",
                    message: "Could not load the saved GitHub token. Open Sources to reconnect."
                });
            }
        }
        return { consumedUrl: false };
    };

    const lock = (): void => {
        state.update(locked);
        for (const controller of requests) controller.abort();
    };

    const connect = async (token: string): Promise<void> => {
        // A new connection replaces any previous session, including in-flight work.
        lock();
        const { generation } = state.get();
        const controller = new AbortController();
        requests.add(controller);
        updateStatus({ phase: "syncing", message: "Connecting to GitHub…" });
        const cancelled = () => {
            if (!isCurrent(generation)) throw new GitHubSourceError("GitHub connection cancelled.");
        };
        try {
            // Bind the local inbox to an account, not a PAT: rotating the PAT keeps the cache,
            // while another account must not mix private inboxes.
            const user = await api.getUser(token, controller.signal);
            await cache.load();
            cancelled();
            const existing = cachedSource(cache.snapshot(), GITHUB_SOURCE_ID);
            if (existing && existing.config.accountId !== user.id) {
                throw new GitHubSourceError(
                    "This browser inbox belongs to another GitHub account. Use a separate browser profile."
                );
            }
            if (!existing) {
                await cache.write((snapshot) =>
                    withSource(snapshot, {
                        id: GITHUB_SOURCE_ID,
                        adapterType: GITHUB_SOURCE_ID,
                        config: {
                            title: TITLE,
                            accountId: user.id,
                            url: homeUrl,
                            iconUrl: DEFAULT_ICON,
                            category: GITHUB_CATEGORY
                        }
                    })
                );
            }
            cancelled();
            state.update((current) =>
                projectFeeds(
                    {
                        ...current,
                        token,
                        retryAfter: 0,
                        status: { phase: "idle", message: "GitHub connected. Ready to sync." }
                    },
                    cache.snapshot(),
                    web
                )
            );
        } catch (error) {
            if (isCurrent(generation)) updateStatus({ phase: "error", message: failureMessage(error) });
            throw error;
        } finally {
            requests.delete(controller);
        }
    };

    /** Load every unread page and reconcile the cache with it, then resolve the details. */
    const syncInbox = async (token: string, generation: number, signal: AbortSignal): Promise<void> => {
        const cancelled = () => {
            if (!isCurrent(generation)) throw new GitHubSourceError("GitHub sync cancelled.");
        };
        const unread = (items: readonly CachedItem[]) => unreadDuringSync(state.get(), generation, items);
        // Checkpoint items without claiming a complete sync: a retry starts from the previous cursor.
        const saveItems = async (items: readonly CachedItem[]): Promise<void> => {
            cancelled();
            if (items.length === 0) return;
            // Filter inside the serialized write: a repository marked read while this write
            // waited in the queue must not come back.
            await cache.write((snapshot) => withItems(snapshot, GITHUB_SOURCE_ID, unread(items)));
            if (isCurrent(generation)) project();
        };
        try {
            await cache.load();
            cancelled();
            const source = cachedSource(cache.snapshot(), GITHUB_SOURCE_ID);
            if (!source) return;
            const nextPollAt = Date.parse(source.cursor?.nextPollAt ?? "");
            if (nextPollAt > options.now()) {
                updateStatus({
                    phase: "waiting",
                    message: `GitHub polling interval: next request after ${new Date(nextPollAt).toLocaleTimeString()}.`
                });
                return;
            }
            updateStatus({ phase: "syncing", message: "Loading GitHub notifications…" });
            const existing = new Map(
                cache
                    .snapshot()
                    .items.filter((item) => item.sourceId === GITHUB_SOURCE_ID)
                    .map((item) => [item.externalId, item])
            );
            /** Unread notification pages in order, following `rel="next"` links to the last page. */
            const loadPages = async (
                url: string,
                visited: ReadonlySet<string>,
                loaded: readonly LoadedPage[]
            ): Promise<readonly LoadedPage[]> => {
                if (visited.has(url)) throw new Error("Invalid GitHub pagination.");
                const page = await api.notificationPage(url, token, signal);
                const entries = page.notifications
                    .filter((notification) => notification.unread !== false)
                    .map((notification) => syncEntry(notification, existing.get(notification.id), web));
                updateStatus({
                    phase: "syncing",
                    message: "Loading GitHub notification pages… Articles appear as they arrive."
                });
                // Titles appear page by page, before details are resolved.
                await saveItems(entries.map((entry) => entry.item));
                const pages = [...loaded, { entries, pollSeconds: page.pollSeconds ?? 0 }];
                return page.next ? loadPages(page.next, new Set([...visited, url]), pages) : pages;
            };
            const pages = await loadPages(api.firstNotificationsUrl(), new Set(), []);
            // Absence means read only after every page succeeded. Body enrichment is
            // optional and must not block cross-browser read reconciliation.
            cancelled();
            // The latest entry of each notification, in first-seen order.
            const entries = new Map(
                pages.flatMap((page) => page.entries).map((entry) => [entry.item.externalId, entry])
            );
            const pollSeconds = Math.max(60, ...pages.map((page) => page.pollSeconds));
            const cursor = { nextPollAt: new Date(options.now() + pollSeconds * 1000).toISOString() };
            await cache.write((snapshot) => {
                const complete = unread([...entries.values()].map((entry) => entry.item));
                const synced = withSourceChange(snapshot, GITHUB_SOURCE_ID, (record) => ({
                    ...record,
                    cursor,
                    lastSyncedAt: new Date(options.now()).toISOString()
                }));
                if (!synced) throw new GitHubSourceError("GitHub source was removed.");
                // Notifications absent from a complete unread snapshot were read elsewhere.
                return withInbox(synced, GITHUB_SOURCE_ID, complete);
            });
            if (isCurrent(generation)) project();
            // Resolve bodies in groups, checkpointing every 100 successes (or on completion/failure).
            const unresolved = [...entries.values()].filter((entry) => !entry.reusable);
            const reused = entries.size - unresolved.length;
            const resolveDetails = async (offset: number, checkpoint: readonly CachedItem[]): Promise<void> => {
                if (offset >= unresolved.length) return;
                // Every earlier group resolved completely: a failure ends the loop.
                updateStatus({
                    phase: "syncing",
                    message: `Loading notification details (${reused + offset}/${entries.size})…`
                });
                const results = await Promise.allSettled(
                    unresolved
                        .slice(offset, offset + DETAILS_CONCURRENCY)
                        .map(async ({ notification, item }) =>
                            withDetails(item, await api.details(notification, token, signal))
                        )
                );
                const resolved = [
                    ...checkpoint,
                    ...results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
                ];
                const failure = results.find((result) => result.status === "rejected");
                const save =
                    resolved.length >= 100 ||
                    failure !== undefined ||
                    offset + DETAILS_CONCURRENCY >= unresolved.length;
                if (save) await saveItems(resolved);
                if (failure) throw failure.reason;
                return resolveDetails(offset + DETAILS_CONCURRENCY, save ? [] : resolved);
            };
            await resolveDetails(0, []);
            cancelled();
            const count = cache.snapshot().items.filter((item) => item.sourceId === GITHUB_SOURCE_ID).length;
            updateStatus({
                phase: "idle",
                message:
                    count > 0
                        ? `GitHub sync complete: ${count} unread notifications.`
                        : "GitHub sync complete: no unread notifications."
            });
        } catch (error) {
            if (!isCurrent(generation)) return;
            state.update((current) => withSyncFailure(current, error, options.now()));
            throw error;
        }
    };

    const sync = (): Promise<void> => {
        const current = state.get();
        const running = syncs.get(current.generation);
        if (running) return running;
        if (!current.token) {
            if (current.status.phase !== "error") updateStatus(LOCKED);
            return Promise.resolve();
        }
        // Back off after failures; keep the failure explanation instead of claiming success.
        if (options.now() < current.retryAfter) return Promise.resolve();
        const { token, generation } = current;
        const controller = new AbortController();
        requests.add(controller);
        state.update((latest) => withSyncStarted(latest, generation));
        const promise = syncInbox(token, generation, controller.signal).finally(() => {
            syncs.delete(generation);
            requests.delete(controller);
            state.update((latest) => withSyncFinished(latest, generation));
        });
        syncs.set(generation, promise);
        return promise;
    };

    const loadItems = async (feedId: string): Promise<ItemPage> => {
        repositoryOfFeed(feedId);
        return { items: state.get().items.get(feedId) ?? [] };
    };

    /** Mark `threads` read on GitHub, a few at a time. Results are in the order of `threads`. */
    const markThreads = async (
        threads: readonly string[],
        token: string,
        signal: AbortSignal,
        settled: readonly PromiseSettledResult<void>[] = []
    ): Promise<readonly PromiseSettledResult<void>[]> => {
        if (settled.length >= threads.length) return settled;
        const results = await Promise.allSettled(
            threads
                .slice(settled.length, settled.length + MARK_READ_CONCURRENCY)
                .map((thread) => api.markThreadRead(thread, token, signal))
        );
        return markThreads(threads, token, signal, [...settled, ...results]);
    };

    /**
     * One PATCH per notification of the repository up to the cutoff, every type included. GitHub's repository-wide
     * PUT can answer 205 and still leave notifications unread, so each thread is marked read explicitly.
     */
    const markRead = async (feedId: string, loadedItems: readonly Item[]): Promise<void> => {
        if (!state.get().token) throw new GitHubSourceError("Connect GitHub before marking notifications read.");
        await cache.load();
        const repository = repositoryOfFeed(feedId);
        const cutoff = readCutoff(cache.snapshot(), loadedItems);
        // Notifications removed meanwhile (read in another browser) need no request.
        if (cutoff === undefined) return;
        if (!Number.isFinite(cutoff) || cutoff <= 0) {
            throw new GitHubSourceError("Cannot safely mark a repository read without its notification timestamp.");
        }
        // Hidden by the display filter or not, every stored notification up to the cutoff is read.
        const readThrough = readThroughOf(cache.snapshot(), GITHUB_SOURCE_ID, repository, cutoff);
        if (readThrough.size === 0) return;
        // The session may have ended while the cache loaded.
        const { token, generation } = state.get();
        if (!token) throw new GitHubSourceError("Connect GitHub before marking notifications read.");
        const controller = new AbortController();
        requests.add(controller);
        try {
            const threads = [...readThrough.keys()];
            const results = await markThreads(threads, token, controller.signal);
            if (!isCurrent(generation)) throw new GitHubSourceError("GitHub read operation cancelled.");
            const read = new Map([...readThrough].filter((_, index) => results[index]?.status === "fulfilled"));
            if (read.size > 0) {
                state.update((current) => withThreadsRead(current, read));
                // Compare with the latest stored timestamps: an update that arrived meanwhile stays.
                await cache.write((snapshot) => withoutRead(snapshot, GITHUB_SOURCE_ID, read));
                if (isCurrent(generation)) project();
            }
            const failure = results.find((result) => result.status === "rejected");
            if (failure) throw failure.reason;
        } catch (error) {
            if (isCurrent(generation)) {
                updateStatus({
                    phase: "error",
                    message: `${failureMessage(error)} Failed notifications remain unread.`
                });
            }
            throw error;
        } finally {
            requests.delete(controller);
        }
    };

    const runAction = async (actionId: string, values: SettingValues): Promise<string> => {
        switch (actionId) {
            case "connect": {
                const token = typeof values.token === "string" ? values.token.trim() : "";
                if (!token) throw new GitHubSourceError("Enter a classic personal access token.");
                await connect(token);
                await options.credentials.set(CREDENTIAL_KEY, { version: 2, token });
                state.update((current) => ({ ...current, savedCredential: true }));
                // Articles appear page by page; failures are reported through the status.
                sync().catch(() => undefined);
                return "GitHub connected.";
            }
            case "disconnect":
                lock();
                await options.credentials.delete(CREDENTIAL_KEY);
                state.update((current) => ({ ...current, savedCredential: false }));
                return "GitHub disconnected and saved token removed.";
            case "setting:releaseOnly": {
                const releaseOnly = values.releaseOnly === true;
                await cache.write((snapshot) => {
                    const next = withSourceChange(snapshot, GITHUB_SOURCE_ID, (source) => ({
                        ...source,
                        config: { ...source.config, releaseOnly }
                    }));
                    if (!next) throw new GitHubSourceError("Connect GitHub first.");
                    return next;
                });
                project();
                return "Display filter saved.";
            }
            default:
                throw new Error(`Unknown action: ${actionId}`);
        }
    };

    return {
        id: GITHUB_SOURCE_ID,
        title: TITLE,
        homeUrl,
        capabilities: CAPABILITIES,
        getSnapshot: view.get,
        subscribe: view.subscribe,
        restore,
        sync,
        loadItems,
        markRead,
        runAction,
        connect,
        lock
    };
}
