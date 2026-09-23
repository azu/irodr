import type { KeyValueStore, WriteLock } from "../../lib/kv-store.ts";
import { createStore } from "../../lib/store.ts";
import { validRepository } from "./github-api.ts";

/**
 * The irodr 1.x source snapshot layout (IndexedDB `irodr-sources`, key `snapshot`),
 * kept so an upgrade keeps the cached inbox.
 */
export interface CachedItem {
    readonly externalId: string;
    readonly sourceId: string;
    readonly title: string;
    readonly url?: string;
    readonly content?: string;
    readonly publishedAt?: string;
    readonly updatedAt?: string;
    readonly metadata?: {
        readonly type?: string;
        readonly repository?: string;
        readonly githubUnread?: boolean;
        readonly detailsResolved?: boolean;
        readonly releaseResolved?: boolean;
        readonly contentVersion?: number;
    };
}

export interface CachedSource {
    readonly id: string;
    readonly adapterType: string;
    readonly config: {
        readonly title?: string;
        readonly accountId?: number;
        readonly url?: string;
        readonly iconUrl?: string;
        readonly category?: string;
        readonly releaseOnly?: boolean;
    };
    readonly cursor?: { readonly nextPollAt?: string };
    readonly lastSyncedAt?: string;
}

export interface CacheSnapshot {
    readonly sources: readonly CachedSource[];
    readonly items: readonly CachedItem[];
    /** Unused; kept for irodr 1.x compatibility. */
    readonly states: readonly unknown[];
}

const KEY = "snapshot";
const EMPTY: CacheSnapshot = { sources: [], items: [], states: [] };

/**
 * One atomic snapshot per write. Web Locks serialize read-modify-write across tabs,
 * and each write reloads the persisted snapshot under the lock first.
 */
export interface GitHubCache {
    /** The snapshot last loaded or written by this tab. */
    readonly snapshot: () => CacheSnapshot;
    /** Read the persisted snapshot once. A failed read is retried by the next call. */
    readonly load: () => Promise<CacheSnapshot>;
    /**
     * Persist `change(persisted)`, then publish it. `change` returns a new snapshot and leaves its
     * argument unchanged. Writes run one at a time, in call order.
     */
    readonly write: (change: (snapshot: CacheSnapshot) => CacheSnapshot) => Promise<CacheSnapshot>;
}

export function createGitHubCache(storage: KeyValueStore, lock: WriteLock): GitHubCache {
    const current = createStore<CacheSnapshot>(EMPTY);
    // Runtime handles, not state: the shared initial read, and the last write of the queue.
    const pending: { load: Promise<CacheSnapshot> | undefined; tail: Promise<unknown> } = {
        load: undefined,
        tail: Promise.resolve()
    };

    const load = (): Promise<CacheSnapshot> => {
        pending.load ??= storage.get<CacheSnapshot>(KEY).then(
            (snapshot) => {
                if (snapshot) current.set(normalize(snapshot));
                return current.get();
            },
            (error: unknown) => {
                pending.load = undefined;
                throw error;
            }
        );
        return pending.load;
    };

    const write = (change: (snapshot: CacheSnapshot) => CacheSnapshot): Promise<CacheSnapshot> => {
        const written = pending.tail.then(async () => {
            await load();
            return lock("irodr-sources:snapshot", async () => {
                const persisted = await storage.get<CacheSnapshot>(KEY);
                const next = change(normalize(persisted ?? current.get()));
                await storage.set(KEY, next);
                current.set(next);
                return next;
            });
        });
        // A failed write must not poison the queue or publish tentative data.
        pending.tail = written.catch(() => undefined);
        return written;
    };

    return { snapshot: current.get, load, write };
}

function normalize(snapshot: Partial<CacheSnapshot>): CacheSnapshot {
    return {
        sources: Array.isArray(snapshot.sources) ? snapshot.sources : [],
        items: Array.isArray(snapshot.items) ? snapshot.items : [],
        states: Array.isArray(snapshot.states) ? snapshot.states : []
    };
}

/** The record of `sourceId`, present once an account was connected. */
export function cachedSource(snapshot: CacheSnapshot, sourceId: string): CachedSource | undefined {
    return snapshot.sources.find((source) => source.id === sourceId);
}

export function withSource(snapshot: CacheSnapshot, source: CachedSource): CacheSnapshot {
    return { ...snapshot, sources: [...snapshot.sources, source] };
}

/** Apply `change` to the record of `sourceId`. Undefined when there is no record. */
export function withSourceChange(
    snapshot: CacheSnapshot,
    sourceId: string,
    change: (source: CachedSource) => CachedSource
): CacheSnapshot | undefined {
    const record = cachedSource(snapshot, sourceId);
    if (!record) return undefined;
    return { ...snapshot, sources: snapshot.sources.map((source) => (source === record ? change(source) : source)) };
}

/** Add or replace items of `sourceId` by external ID: replaced items keep their position, new ones are appended. */
export function withItems(snapshot: CacheSnapshot, sourceId: string, items: readonly CachedItem[]): CacheSnapshot {
    const updates = new Map(items.map((item) => [item.externalId, item]));
    // Where a notification is stored more than once, its last copy is replaced.
    const positions = new Map(
        snapshot.items.flatMap((item, index) => (item.sourceId === sourceId ? [[item.externalId, index] as const] : []))
    );
    return {
        ...snapshot,
        items: [
            ...snapshot.items.map((item, index) =>
                positions.get(item.externalId) === index ? (updates.get(item.externalId) ?? item) : item
            ),
            ...[...updates.values()].filter((item) => !positions.has(item.externalId))
        ]
    };
}

/** Replace the items of `sourceId` with a complete unread inbox: notifications absent from it were read elsewhere. */
export function withInbox(snapshot: CacheSnapshot, sourceId: string, items: readonly CachedItem[]): CacheSnapshot {
    const retained = new Set(items.map((item) => item.externalId));
    const kept = snapshot.items.filter((item) => item.sourceId !== sourceId || retained.has(item.externalId));
    return withItems({ ...snapshot, items: kept }, sourceId, items);
}

/** Whether a repository-wide read through `readThrough` (repository → epoch milliseconds) covers `item`. */
export function isCoveredByRead(item: CachedItem, readThrough: ReadonlyMap<string, number>): boolean {
    const repository = validRepository(item.metadata?.repository);
    const cutoff = repository ? readThrough.get(repository) : undefined;
    const updated = Date.parse(item.updatedAt ?? "");
    return cutoff !== undefined && Number.isFinite(updated) && updated <= cutoff;
}

/** Remove the items of `sourceId` that a repository-wide read through `readThrough` covers. */
export function withoutRead(
    snapshot: CacheSnapshot,
    sourceId: string,
    readThrough: ReadonlyMap<string, number>
): CacheSnapshot {
    return {
        ...snapshot,
        items: snapshot.items.filter((item) => item.sourceId !== sourceId || !isCoveredByRead(item, readThrough))
    };
}
