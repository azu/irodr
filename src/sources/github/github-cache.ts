import type { KeyValueStore, WriteLock } from "../../lib/kv-store.ts";

/**
 * The irodr 1.x source snapshot layout (IndexedDB `irodr-sources`, key `snapshot`),
 * kept so an upgrade keeps the cached inbox.
 */
export interface CachedItem {
    externalId: string;
    sourceId: string;
    title: string;
    url?: string;
    content?: string;
    publishedAt?: string;
    updatedAt?: string;
    metadata?: {
        type?: string;
        repository?: string;
        githubUnread?: boolean;
        detailsResolved?: boolean;
        releaseResolved?: boolean;
        contentVersion?: number;
    };
}

export interface CachedSource {
    id: string;
    adapterType: string;
    config: {
        title?: string;
        accountId?: number;
        url?: string;
        iconUrl?: string;
        category?: string;
        releaseOnly?: boolean;
    };
    cursor?: { nextPollAt?: string };
    lastSyncedAt?: string;
}

export interface CacheSnapshot {
    sources: CachedSource[];
    items: CachedItem[];
    /** Unused; kept for irodr 1.x compatibility. */
    states: unknown[];
}

const KEY = "snapshot";
const EMPTY: CacheSnapshot = { sources: [], items: [], states: [] };

/**
 * One atomic snapshot per write. Web Locks serialize read-modify-write across tabs,
 * and each write reloads the persisted snapshot under the lock first.
 */
export class GitHubCache {
    #snapshot: CacheSnapshot = EMPTY;
    #loading?: Promise<CacheSnapshot>;
    #writes: Promise<unknown> = Promise.resolve();
    private readonly storage: KeyValueStore;
    private readonly lock: WriteLock;

    constructor(storage: KeyValueStore, lock: WriteLock) {
        this.storage = storage;
        this.lock = lock;
    }

    get snapshot(): CacheSnapshot {
        return this.#snapshot;
    }

    load(): Promise<CacheSnapshot> {
        this.#loading ??= this.storage.get<CacheSnapshot>(KEY).then(
            (snapshot) => {
                if (snapshot) this.#snapshot = normalize(snapshot);
                return this.#snapshot;
            },
            (error: unknown) => {
                this.#loading = undefined;
                throw error;
            }
        );
        return this.#loading;
    }

    /** Apply `change` to a fresh copy of the persisted snapshot, then publish it. */
    write(change: (snapshot: CacheSnapshot) => void): Promise<CacheSnapshot> {
        const write = this.#writes.then(async () => {
            await this.load();
            return this.lock("irodr-sources:snapshot", async () => {
                const persisted = await this.storage.get<CacheSnapshot>(KEY);
                const next = structuredClone(normalize(persisted ?? this.#snapshot));
                change(next);
                await this.storage.set(KEY, next);
                this.#snapshot = next;
                return next;
            });
        });
        // A failed write must not poison the queue or publish tentative data.
        this.#writes = write.catch(() => undefined);
        return write;
    }
}

function normalize(snapshot: Partial<CacheSnapshot>): CacheSnapshot {
    return {
        sources: Array.isArray(snapshot.sources) ? snapshot.sources : [],
        items: Array.isArray(snapshot.items) ? snapshot.items : [],
        states: Array.isArray(snapshot.states) ? snapshot.states : []
    };
}
