import { ItemState, SourceItem } from "../../domain/Sources/SourceAdapter";
import { createStorageInstance } from "./Storage";

/**
 * Config and cursor must be JSON-serializable and contain no credentials.
 * Callers must store tokens in SourceCredentialsRepository, never in this store.
 */
export interface SourceRecord {
    id: string;
    adapterType: string;
    config: Record<string, unknown>;
    cursor?: unknown;
    lastSyncedAt?: string;
}

export function sourceItemId(sourceId: string, externalId: string): string {
    return `source:${encodeURIComponent(sourceId)}:${encodeURIComponent(externalId)}`;
}

interface Snapshot {
    sources: SourceRecord[];
    items: SourceItem[];
    states: ItemState[];
}

export interface SourceSnapshotStorage {
    getItem<T>(key: string): Promise<T | null>;
    setItem<T>(key: string, value: T): Promise<T>;
}

export type SourceWriteLock = (write: () => Promise<void>) => Promise<void>;

const browserWriteLock: SourceWriteLock = async (write) => {
    if (typeof navigator !== "undefined" && navigator.locks) {
        return navigator.locks.request("irodr-sources:snapshot", write);
    }
    return write();
};

// Detach both input and output so callers cannot mutate committed data.
function copy<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

/**
 * A single snapshot makes each sync (items + cursor) an atomic storage write.
 * Web Locks serialize read/modify/write across tabs; without Web Locks, only
 * single-tab use of the singleton is supported. Reads reflect the last locally
 * loaded/committed snapshot, not live changes from other tabs.
 */
export class SourceRepository {
    private snapshot: Snapshot = { sources: [], items: [], states: [] };
    private stateIndex = new Map<string, ItemState>();
    private loading?: Promise<void>;
    private writes: Promise<void> = Promise.resolve();

    constructor(
        private readonly storage: SourceSnapshotStorage = createStorageInstance({ name: "irodr-sources" }),
        private readonly withWriteLock: SourceWriteLock = browserWriteLock
    ) {}

    private publish(snapshot: Snapshot): void {
        this.snapshot = snapshot;
        this.stateIndex = new Map(snapshot.states.map((state) => [state.itemId, state]));
    }

    ready(): Promise<void> {
        if (!this.loading) {
            this.loading = this.storage.getItem<Snapshot>("snapshot").then(
                (snapshot) => {
                    if (snapshot) {
                        this.publish(copy(snapshot));
                    }
                },
                (error) => {
                    this.loading = undefined;
                    throw error;
                }
            );
        }
        return this.loading;
    }

    getSources(): SourceRecord[] {
        return copy(this.snapshot.sources);
    }

    getItems(sourceId: string): SourceItem[] {
        return copy(this.snapshot.items.filter((item) => item.sourceId === sourceId));
    }

    getState(itemId: string): ItemState | undefined {
        const state = this.stateIndex.get(itemId);
        return state ? copy(state) : undefined;
    }

    private write(change: (snapshot: Snapshot, states: Map<string, ItemState>) => void): Promise<void> {
        const write = this.writes.then(async () => {
            await this.ready();
            await this.withWriteLock(async () => {
                // Reload inside the lock: another tab may have committed since ready().
                const persisted = await this.storage.getItem<Snapshot>("snapshot");
                const next: Snapshot = persisted ? copy(persisted) : { sources: [], items: [], states: [] };
                const states = new Map(next.states.map((state) => [state.itemId, state]));
                change(next, states);
                await this.storage.setItem("snapshot", next);
                this.publish(next);
            });
        });
        // A failed persistence must not poison the queue or publish tentative data.
        this.writes = write.catch(() => undefined);
        return write;
    }

    saveSource(source: SourceRecord): Promise<void> {
        const saved = copy(source);
        return this.write((snapshot) => {
            const index = snapshot.sources.findIndex((item) => item.id === saved.id);
            if (index === -1) {
                snapshot.sources.push(saved);
            } else {
                snapshot.sources[index] = saved;
            }
        });
    }

    updateSourceConfig(sourceId: string, changes: Record<string, unknown>): Promise<void> {
        const config = copy(changes);
        return this.write((snapshot) => {
            const source = snapshot.sources.find((item) => item.id === sourceId);
            if (!source) throw new Error(`Unknown source: ${sourceId}`);
            source.config = { ...source.config, ...config };
        });
    }

    commitSync(sourceId: string, items: SourceItem[], cursor: unknown): Promise<void> {
        return this.writeItems(sourceId, items, { cursor });
    }

    /** Replace a source's cached inbox only after fetching a complete snapshot. */
    commitSnapshot(sourceId: string, items: SourceItem[], cursor: unknown): Promise<void> {
        return this.writeItems(sourceId, items, { cursor }, true);
    }

    removeItems(sourceId: string, externalIds: string[]): Promise<void> {
        const ids = new Set(externalIds.map((id) => sourceItemId(sourceId, id)));
        return this.removeMatchingItems(sourceId, (item) => ids.has(sourceItemId(sourceId, item.externalId)));
    }

    removeMatchingItems(sourceId: string, matches: (item: SourceItem) => boolean): Promise<void> {
        return this.write((snapshot) => {
            const ids = new Set(
                snapshot.items
                    .filter((item) => item.sourceId === sourceId && matches(item))
                    .map((item) => sourceItemId(sourceId, item.externalId))
            );
            snapshot.items = snapshot.items.filter((item) => !ids.has(sourceItemId(item.sourceId, item.externalId)));
            snapshot.states = snapshot.states.filter((state) => !ids.has(state.itemId));
        });
    }

    // Checkpoint items from a partial batch without claiming a successful sync.
    // A retry still starts at the previous committed cursor.
    saveItems(sourceId: string, items: SourceItem[]): Promise<void> {
        return this.writeItems(sourceId, items);
    }

    private writeItems(
        sourceId: string,
        items: SourceItem[],
        completed?: { cursor: unknown },
        replace = false
    ): Promise<void> {
        if (items.some((item) => item.sourceId !== sourceId)) {
            return Promise.reject(new Error("Cannot commit items belonging to another source"));
        }
        const incoming = copy(items);
        const nextCursor = completed?.cursor === undefined ? undefined : copy(completed.cursor);
        return this.write((snapshot, states) => {
            const source = snapshot.sources.find((source) => source.id === sourceId);
            if (!source) {
                throw new Error(`Unknown source: ${sourceId}`);
            }
            if (replace) {
                const retained = new Set(incoming.map((item) => sourceItemId(sourceId, item.externalId)));
                const removed = new Set(
                    snapshot.items
                        .filter(
                            (item) =>
                                item.sourceId === sourceId && !retained.has(sourceItemId(sourceId, item.externalId))
                        )
                        .map((item) => sourceItemId(sourceId, item.externalId))
                );
                snapshot.items = snapshot.items.filter(
                    (item) => !removed.has(sourceItemId(item.sourceId, item.externalId))
                );
                snapshot.states = snapshot.states.filter((state) => !removed.has(state.itemId));
            }
            const itemIndices = new Map(
                snapshot.items.map((item, index) => [sourceItemId(item.sourceId, item.externalId), index])
            );
            for (const item of incoming) {
                const id = sourceItemId(sourceId, item.externalId);
                const index = itemIndices.get(id);
                if (index === undefined) {
                    itemIndices.set(id, snapshot.items.length);
                    snapshot.items.push(item);
                } else {
                    snapshot.items[index] = item;
                }
                this.state(snapshot, states, id);
            }
            if (completed) {
                source.cursor = nextCursor;
                source.lastSyncedAt = new Date().toISOString();
            }
        });
    }

    private state(snapshot: Snapshot, states: Map<string, ItemState>, itemId: string): ItemState {
        let state = states.get(itemId);
        if (!state) {
            state = {
                itemId,
                read: false,
                readStateUpdatedAt: new Date(0).toISOString(),
                starred: false,
                starStateUpdatedAt: new Date(0).toISOString()
            };
            snapshot.states.push(state);
            states.set(itemId, state);
        }
        return state;
    }

    setRead(itemIds: string[], read: boolean): Promise<void> {
        const ids = [...itemIds];
        return this.write((snapshot, states) => {
            const now = new Date().toISOString();
            for (const id of ids) {
                const state = this.state(snapshot, states, id);
                state.read = read;
                state.readStateUpdatedAt = now;
            }
        });
    }

    setStarred(itemId: string, starred: boolean): Promise<void> {
        return this.write((snapshot, states) => {
            const state = this.state(snapshot, states, itemId);
            state.starred = starred;
            state.starStateUpdatedAt = new Date().toISOString();
        });
    }
}

export const sourceRepository = new SourceRepository();
