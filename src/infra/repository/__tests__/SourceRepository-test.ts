import { SourceRepository, sourceItemId } from "../SourceRepository";
import { createStorageInstance, storageManger } from "../Storage";

describe("SourceRepository", () => {
    let storage: LocalForage;
    let repository: SourceRepository;
    const source = { id: "feed", adapterType: "test", config: {} };
    const item = { sourceId: "feed", externalId: "entry", title: "First" };
    const id = sourceItemId(item.sourceId, item.externalId);

    beforeAll(async () => {
        await storageManger.useMemoryDriver();
    });

    beforeEach(async () => {
        storage = createStorageInstance({ name: "source-repository-test" });
        await storage.clear();
        repository = new SourceRepository(storage);
        await repository.ready();
        await repository.saveSource(source);
    });

    it("encodes both ID components without delimiter collisions", () => {
        expect(sourceItemId("a:b", "c")).not.toBe(sourceItemId("a", "b:c"));
        expect(sourceItemId("a/b", "日本語 ?#%")).toBe("source:a%2Fb:%E6%97%A5%E6%9C%AC%E8%AA%9E%20%3F%23%25");
    });

    it("upserts idempotently, preserves state and reloads a complete snapshot", async () => {
        await repository.commitSync("feed", [item, item], "cursor-1");
        expect(repository.getState(id)).toEqual({
            itemId: id,
            read: false,
            readStateUpdatedAt: new Date(0).toISOString(),
            starred: false,
            starStateUpdatedAt: new Date(0).toISOString()
        });
        const initiallyReloaded = new SourceRepository(storage);
        await initiallyReloaded.ready();
        expect(initiallyReloaded.getState(id)).toEqual(repository.getState(id));
        await repository.setRead([id], true);
        await repository.setStarred(id, true);
        const state = repository.getState(id);
        await repository.commitSync("feed", [{ ...item, title: "Updated" }], "cursor-2");
        expect(repository.getItems("feed")).toEqual([{ ...item, title: "Updated" }]);
        expect(repository.getState(id)).toEqual(state);
        const reloaded = new SourceRepository(storage);
        await reloaded.ready();
        expect(reloaded.getSources()[0]).toMatchObject({ ...source, cursor: "cursor-2" });
        expect(reloaded.getItems("feed")).toEqual(repository.getItems("feed"));
        expect(reloaded.getState(id)).toEqual(state);
    });

    it("serializes simultaneous read, sync and star writes without losing fields", async () => {
        await Promise.all([
            repository.setRead([id], true),
            repository.commitSync("feed", [item], "next"),
            repository.setStarred(id, true)
        ]);
        expect(repository.getState(id)).toMatchObject({ read: true, starred: true });
        await repository.setRead([id], false);
        expect(repository.getState(id)).toMatchObject({ read: false, starred: true });
    });

    it("updates display preferences without replacing the last synced cursor", async () => {
        await repository.commitSnapshot("feed", [item], "current-cursor");
        const previous = repository.getSources()[0];
        await repository.updateSourceConfig("feed", { releaseOnly: true });
        expect(repository.getSources()[0]).toEqual({ ...previous, config: { releaseOnly: true } });
        expect(repository.getItems("feed")).toEqual([item]);
    });

    it("replaces complete inbox snapshots without deleting another source or publishing failed writes", async () => {
        await repository.saveSource({ ...source, id: "other" });
        await repository.commitSync("other", [{ ...item, sourceId: "other" }], "other-cursor");
        await repository.commitSync("feed", [item, { ...item, externalId: "gone" }], "old");
        await repository.commitSnapshot("feed", [item], "new");
        expect(repository.getItems("feed")).toEqual([item]);
        expect(repository.getState(sourceItemId("feed", "gone"))).toBeUndefined();
        const fail = jest.spyOn(storage, "setItem").mockRejectedValueOnce(new Error("Disk full"));
        await expect(repository.commitSnapshot("feed", [], "not-saved")).rejects.toThrow("Disk full");
        expect(repository.getItems("feed")).toEqual([item]);
        fail.mockRestore();
        await repository.commitSnapshot("feed", [], "empty");
        expect(repository.getItems("feed")).toEqual([]);
        expect(repository.getItems("other")).toHaveLength(1);
    });

    it("checkpoints partial items without changing cursor or last successful sync, preserving reader state", async () => {
        await repository.commitSync("feed", [item], "old-cursor");
        const before = repository.getSources()[0];
        await repository.setStarred(id, true);
        await repository.saveItems("feed", [
            { ...item, content: "New body" },
            { ...item, externalId: "second" }
        ]);
        expect(repository.getSources()[0]).toEqual(before);
        const reloaded = new SourceRepository(storage);
        await reloaded.ready();
        expect(reloaded.getSources()[0]).toEqual(before);
        expect(reloaded.getItems("feed")).toHaveLength(2);
        expect(reloaded.getState(id)?.starred).toBe(true);
        await expect(repository.saveItems("feed", [{ ...item, sourceId: "other" }])).rejects.toThrow("another source");
    });

    it("reloads inside a shared lock so independent tabs preserve each other's writes", async () => {
        let queue = Promise.resolve();
        let locked = false;
        const lock = (write: () => Promise<void>): Promise<void> => {
            const pending = queue.then(async () => {
                locked = true;
                try {
                    await write();
                } finally {
                    locked = false;
                }
            });
            queue = pending.catch(() => undefined);
            return pending;
        };
        const first = new SourceRepository(storage, lock);
        const second = new SourceRepository(storage, lock);
        await Promise.all([first.ready(), second.ready()]);
        const getItem = storage.getItem.bind(storage);
        const reads = jest.spyOn(storage, "getItem").mockImplementation((key) => {
            expect(locked).toBe(true);
            return getItem(key);
        });
        try {
            await Promise.all([
                first.commitSync("feed", [item], "from-first"),
                second.setRead([id], true),
                first.setStarred(id, true)
            ]);
        } finally {
            reads.mockRestore();
        }
        const reloaded = new SourceRepository(storage);
        await reloaded.ready();
        expect(reloaded.getItems("feed")).toEqual([item]);
        expect(reloaded.getSources()[0].cursor).toBe("from-first");
        expect(reloaded.getState(id)).toMatchObject({ read: true, starred: true });
    });

    it("uses the browser Web Lock by default", async () => {
        const original = Object.getOwnPropertyDescriptor(navigator, "locks");
        const request = jest.fn((_name: string, write: () => Promise<void>) => write());
        Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
        try {
            await repository.commitSync("feed", [item], "locked");
            expect(request).toHaveBeenCalledWith("irodr-sources:snapshot", expect.any(Function));
        } finally {
            if (original) {
                Object.defineProperty(navigator, "locks", original);
            } else {
                Reflect.deleteProperty(navigator, "locks");
            }
        }
    });

    it("indexes batch upserts and maintains independent state entries", async () => {
        const batch = Array.from({ length: 1000 }, (_, index) => ({ ...item, externalId: String(index) }));
        await repository.commitSync("feed", [...batch, { ...batch[0], title: "Last wins" }], "batch");
        expect(repository.getItems("feed")).toHaveLength(batch.length);
        expect(repository.getItems("feed")[0].title).toBe("Last wins");
        const ids = batch.map((entry) => sourceItemId(entry.sourceId, entry.externalId));
        await repository.setRead([...ids, ...ids], true);
        await repository.setStarred(ids[0], true);
        expect(ids.every((id) => repository.getState(id)?.read)).toBe(true);
        expect(repository.getState(ids[0])?.starred).toBe(true);
        expect(repository.getState(ids[1])?.starred).toBe(false);
        const persisted = await storage.getItem<{ states: unknown[] }>("snapshot");
        expect(persisted?.states).toHaveLength(batch.length);
    });

    it("does not publish a failed sync's items or cursor and recovers its queue", async () => {
        await repository.commitSync("feed", [item], "old");
        const before = repository.getSources();
        const failure = jest.spyOn(storage, "setItem").mockRejectedValueOnce(new Error("Disk full"));
        await expect(repository.commitSync("feed", [{ ...item, title: "Not saved" }], "not-saved")).rejects.toThrow(
            "Disk full"
        );
        expect(repository.getItems("feed")).toEqual([item]);
        expect(repository.getSources()).toEqual(before);
        const reloaded = new SourceRepository(storage);
        await reloaded.ready();
        expect(reloaded.getSources()).toEqual(before);
        expect(reloaded.getItems("feed")).toEqual([item]);
        await repository.setStarred(id, true);
        expect(repository.getState(id)?.starred).toBe(true);
        failure.mockRestore();
    });

    it("rejects foreign items and unknown sources", async () => {
        await expect(repository.commitSync("feed", [{ ...item, sourceId: "other" }], "bad")).rejects.toThrow(
            "another source"
        );
        await expect(repository.commitSync("missing", [], "bad")).rejects.toThrow("Unknown source");
        expect(repository.getItems("feed")).toEqual([]);
        expect(repository.getSources()[0].cursor).toBeUndefined();
    });

    it("does not expose mutable snapshot references", async () => {
        await repository.commitSync("feed", [item], undefined);
        repository.getSources()[0].config.changed = true;
        repository.getItems("feed")[0].title = "Changed";
        expect(repository.getSources()[0].config).toEqual({});
        expect(repository.getItems("feed")[0].title).toBe("First");
    });
});
