import { describe, expect, it } from "vite-plus/test";
import { createMemoryStore, type KeyValueStore, noWriteLock } from "../../lib/kv-store.ts";
import {
    type CachedItem,
    type CachedSource,
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

/** Freeze `value` deeply, so a transition that mutates its input throws. */
function frozen<T>(value: T): T {
    if (value && typeof value === "object") {
        for (const child of Object.values(value)) frozen(child);
        Object.freeze(value);
    }
    return value;
}

const item = (externalId: string, overrides: Partial<CachedItem> = {}): CachedItem => ({
    externalId,
    sourceId: "github-notifications",
    title: `Notification ${externalId}`,
    updatedAt: "2026-09-01T10:00:00.000Z",
    metadata: { type: "Issue", repository: "acme/rocket", githubUnread: true },
    ...overrides
});

const source: CachedSource = {
    id: "github-notifications",
    adapterType: "github-notifications",
    config: { accountId: 1 }
};

const snapshotOf = (items: readonly CachedItem[], sources: readonly CachedSource[] = [source]): CacheSnapshot =>
    frozen({ sources, items, states: [] });

const ids = (snapshot: CacheSnapshot) => snapshot.items.map((entry) => `${entry.sourceId}:${entry.externalId}`);

describe("cache snapshot transitions", () => {
    it("replaces items in place and appends new ones", () => {
        const before = snapshotOf([item("1"), item("2", { sourceId: "other" }), item("3")]);
        const after = withItems(before, "github-notifications", [
            item("3", { title: "Updated" }),
            item("4"),
            item("2")
        ]);
        expect(ids(after)).toEqual([
            "github-notifications:1",
            "other:2",
            "github-notifications:3",
            "github-notifications:4",
            "github-notifications:2"
        ]);
        expect(after.items[2]?.title).toBe("Updated");
        // Items of another source with the same external ID stay.
        expect(after.items[1]).toBe(before.items[1]);
        expect(after.items[0]).toBe(before.items[0]);
    });

    it("keeps the last of repeated items, at the first position", () => {
        const after = withItems(snapshotOf([]), "github-notifications", [
            item("1", { title: "First" }),
            item("2"),
            item("1", { title: "Second" })
        ]);
        expect(after.items.map((entry) => [entry.externalId, entry.title])).toEqual([
            ["1", "Second"],
            ["2", "Notification 2"]
        ]);
    });

    it("replaces only the last stored copy of a notification", () => {
        const after = withItems(
            snapshotOf([item("1", { title: "Old" }), item("1", { title: "Newer" })]),
            "github-notifications",
            [item("1", { title: "Latest" })]
        );
        expect(after.items.map((entry) => entry.title)).toEqual(["Old", "Latest"]);
    });

    it("replaces the inbox of a source and drops notifications absent from it", () => {
        const before = snapshotOf([item("1"), item("2"), item("2", { sourceId: "other" }), item("3")]);
        const after = withInbox(before, "github-notifications", [item("3", { title: "Updated" }), item("4")]);
        expect(ids(after)).toEqual(["other:2", "github-notifications:3", "github-notifications:4"]);
        expect(after.items[1]?.title).toBe("Updated");
    });

    it("removes the items a read covers unless they were updated since", () => {
        const readThrough = new Map([
            ["1", Date.parse("2026-09-01T10:00:00.000Z")],
            ["2", Date.parse("2026-09-01T10:00:00.000Z")],
            ["4", Date.parse("2026-09-01T10:00:00.000Z")],
            ["5", Date.parse("2026-09-01T10:00:00.000Z")]
        ]);
        const before = snapshotOf([
            item("1"),
            item("2", { updatedAt: "2026-09-01T10:00:01.000Z" }),
            item("3"),
            item("4", { updatedAt: undefined }),
            item("5", { sourceId: "other" })
        ]);
        expect(ids(withoutRead(before, "github-notifications", readThrough))).toEqual([
            "github-notifications:2",
            "github-notifications:3",
            "github-notifications:4",
            "other:5"
        ]);
    });

    it("selects the notifications of a repository updated through a cutoff", () => {
        const snapshot = snapshotOf([
            item("1"),
            item("2", { updatedAt: "2026-09-01T10:00:01.000Z" }),
            item("3", { metadata: { repository: "acme/tools" } }),
            item("4", { updatedAt: undefined }),
            item("5", { sourceId: "other" }),
            item("6", { metadata: { repository: "acme/rocket", githubUnread: false } }),
            item("7", { updatedAt: "2026-09-01T09:00:00.000Z" })
        ]);
        const cutoff = Date.parse("2026-09-01T10:00:00.000Z");
        expect(readThroughOf(snapshot, "github-notifications", "acme/rocket", cutoff)).toEqual(
            new Map([
                ["1", cutoff],
                ["7", Date.parse("2026-09-01T09:00:00.000Z")]
            ])
        );
        expect(isCoveredByRead(item("1"), new Map([["1", cutoff - 1]]))).toBe(false);
    });

    it("adds and changes source records", () => {
        const empty = snapshotOf([], []);
        expect(cachedSource(empty, "github-notifications")).toBeUndefined();
        expect(
            withSourceChange(empty, "github-notifications", (record) => ({ ...record, lastSyncedAt: "now" }))
        ).toBeUndefined();
        const added = withSource(empty, source);
        expect(cachedSource(added, "github-notifications")).toBe(source);
        const changed = withSourceChange(frozen(added), "github-notifications", (record) => ({
            ...record,
            config: { ...record.config, releaseOnly: true }
        }));
        expect(changed?.sources).toEqual([{ ...source, config: { accountId: 1, releaseOnly: true } }]);
        expect(empty.sources).toEqual([]);
    });
});

const stored = (storage: KeyValueStore) => storage.get<CacheSnapshot>("snapshot");

describe("createGitHubCache", () => {
    it("loads the stored snapshot once", async () => {
        const storage = createMemoryStore({ snapshot: { sources: [source], items: [item("1")] } });
        const cache = createGitHubCache(storage, noWriteLock);
        expect(cache.snapshot()).toEqual({ sources: [], items: [], states: [] });
        const loaded = await cache.load();
        expect(loaded).toEqual({ sources: [source], items: [item("1")], states: [] });
        await storage.set("snapshot", { sources: [], items: [], states: [] });
        expect(await cache.load()).toBe(loaded);
        expect(cache.snapshot()).toBe(loaded);
    });

    it("applies each write to the latest stored snapshot, in call order", async () => {
        const storage = createMemoryStore({ snapshot: { sources: [source], items: [], states: [] } });
        const cache = createGitHubCache(storage, noWriteLock);
        await cache.load();
        // Another tab writes meanwhile.
        await storage.set("snapshot", { sources: [source], items: [item("1")], states: [] });
        const first = cache.write((snapshot) => withItems(snapshot, "github-notifications", [item("2")]));
        const second = cache.write((snapshot) => withItems(snapshot, "github-notifications", [item("3")]));
        await Promise.all([first, second]);
        expect(ids(cache.snapshot())).toEqual([
            "github-notifications:1",
            "github-notifications:2",
            "github-notifications:3"
        ]);
        expect(await stored(storage)).toEqual(cache.snapshot());
    });

    it("runs writes under the lock", async () => {
        const locks: string[] = [];
        const cache = createGitHubCache(createMemoryStore(), (name, write) => {
            locks.push(name);
            return write();
        });
        await cache.write((snapshot) => withSource(snapshot, source));
        expect(locks).toEqual(["irodr-sources:snapshot"]);
    });

    it("neither stores nor publishes a rejected change, and keeps writing", async () => {
        const storage = createMemoryStore();
        const cache = createGitHubCache(storage, noWriteLock);
        const failed = cache.write(() => {
            throw new Error("Rejected change");
        });
        const next = cache.write((snapshot) => withSource(snapshot, source));
        await expect(failed).rejects.toThrow("Rejected change");
        await next;
        expect(cache.snapshot().sources).toEqual([source]);
        expect(await stored(storage)).toEqual({ sources: [source], items: [], states: [] });
    });

    it("publishes nothing that failed to be stored, and keeps writing", async () => {
        const memory = createMemoryStore({ snapshot: { sources: [source], items: [], states: [] } });
        const failures = { remaining: 1 };
        const storage: KeyValueStore = {
            ...memory,
            set: async (key, value) => {
                if (failures.remaining > 0) {
                    failures.remaining -= 1;
                    throw new Error("QuotaExceededError");
                }
                return memory.set(key, value);
            }
        };
        const cache = createGitHubCache(storage, noWriteLock);
        const loaded = await cache.load();
        await expect(
            cache.write((snapshot) => withItems(snapshot, "github-notifications", [item("1")]))
        ).rejects.toThrow("QuotaExceededError");
        expect(cache.snapshot()).toBe(loaded);
        expect(await stored(storage)).toEqual(loaded);
        // The queue goes on with the stored snapshot, without the failed change.
        await cache.write((snapshot) => withItems(snapshot, "github-notifications", [item("2")]));
        expect(ids(cache.snapshot())).toEqual(["github-notifications:2"]);
        expect(await stored(storage)).toEqual(cache.snapshot());
    });

    it("retries a failed load", async () => {
        const memory = createMemoryStore({ snapshot: { sources: [source], items: [], states: [] } });
        const failures = { remaining: 1 };
        const storage: KeyValueStore = {
            ...memory,
            get: async <T>(key: string) => {
                if (failures.remaining > 0) {
                    failures.remaining -= 1;
                    throw new Error("IndexedDB unavailable");
                }
                return memory.get<T>(key);
            }
        };
        const cache = createGitHubCache(storage, noWriteLock);
        await expect(cache.load()).rejects.toThrow("IndexedDB unavailable");
        expect((await cache.load()).sources).toEqual([source]);
    });
});
