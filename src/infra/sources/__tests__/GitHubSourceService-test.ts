import { GITHUB_SOURCE_ID, GitHubSourceSession } from "../GitHubSourceService";
import { SourceRepository, SourceSnapshotStorage, sourceItemId } from "../../repository/SourceRepository";
import { SourceCredentialsRepository, sourceCredentialsRepository } from "../../repository/SourceCredentialsRepository";

function createStore() {
    const data = new Map<string, unknown>();
    const storage: SourceSnapshotStorage & { removeItem(key: string): Promise<void> } = {
        getItem: async <T>(key: string) => (data.get(key) as T) || null,
        setItem: async <T>(key: string, value: T) => {
            data.set(key, value);
            return value;
        },
        removeItem: async (key) => {
            data.delete(key);
        }
    };
    return { store: new SourceRepository(storage), storage };
}

function response(json: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(headers),
        json: async () => json
    } as Response;
}

function notification(id: string, repository = "owner/repo") {
    return {
        id,
        unread: true,
        updated_at: "2026-01-01T00:00:00Z",
        subject: {
            type: "Release",
            title: `Release ${id}`,
            url: `https://api.github.com/repos/${repository}/releases/${id}`
        },
        repository: { full_name: repository }
    };
}

function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe("GitHubSourceSession progress and checkpoints", () => {
    const originalFetch = global.fetch;
    beforeEach(() => {
        jest.spyOn(sourceCredentialsRepository, "load").mockResolvedValue(undefined);
    });
    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it("restores a saved token on reload and syncs without another connection or passphrase", async () => {
        const { store, storage } = createStore();
        const credentials = new SourceCredentialsRepository(storage);
        global.fetch = jest.fn(async (input) =>
            String(input).endsWith("/user") ? response({ id: 123 }) : response([])
        );
        const first = new GitHubSourceSession(store, credentials);
        await first.connect("test-only-token");
        await credentials.save(GITHUB_SOURCE_ID, "test-only-token");
        first.lock();
        const reloaded = new GitHubSourceSession(store, credentials);
        await reloaded.restore();
        expect(reloaded.isUnlocked).toBe(true);
        expect(reloaded.status.message).toContain("restored");
        await reloaded.sync();
        const requests = (global.fetch as jest.Mock).mock.calls;
        expect(requests.filter(([url]) => String(url).endsWith("/user"))).toHaveLength(1);
        expect(requests[1][1].headers.Authorization).toBe("Bearer test-only-token");
        expect(JSON.stringify(store.getSources())).not.toContain("test-only-token");
        reloaded.lock();
        await credentials.remove(GITHUB_SOURCE_ID);
        const disconnected = new GitHubSourceSession(store, credentials);
        await disconnected.restore();
        expect(disconnected.isUnlocked).toBe(false);
    });

    it("does not restore an in-flight saved token after disconnecting", async () => {
        const { store, storage } = createStore();
        const credentials = new SourceCredentialsRepository(storage);
        const loading = gate();
        jest.spyOn(credentials, "load").mockImplementation(async () => {
            await loading.promise;
            return "test-only-token";
        });
        const session = new GitHubSourceSession(store, credentials);
        const restoring = session.restore();
        session.lock();
        loading.resolve();
        await restoring;
        expect(session.isUnlocked).toBe(false);
    });

    it("restores credentials on Refresh without app boot after replacing an in-memory session", async () => {
        const { store, storage } = createStore();
        const credentials = new SourceCredentialsRepository(storage);
        global.fetch = jest.fn(async (input) =>
            String(input).endsWith("/user") ? response({ id: 123 }) : response([])
        );
        const oldSession = new GitHubSourceSession(store, credentials);
        await oldSession.connect("test-only-token");
        await credentials.save(GITHUB_SOURCE_ID, "test-only-token");
        const replacement = new GitHubSourceSession(store, credentials);
        // Deliberately do not call restore()/boot, matching hot module replacement.
        await replacement.sync();
        expect(replacement.isUnlocked).toBe(true);
        expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain("/notifications?");
        expect((global.fetch as jest.Mock).mock.calls[1][1].headers.Authorization).toBe("Bearer test-only-token");
        replacement.lock();
        const count = (global.fetch as jest.Mock).mock.calls.length;
        await replacement.sync();
        expect(replacement.isUnlocked).toBe(false);
        expect(global.fetch).toHaveBeenCalledTimes(count);
    });

    it("ignores old date windows without replacing cache metadata on a failed snapshot", async () => {
        const now = Date.now();
        jest.spyOn(Date, "now").mockReturnValue(now);
        const { store } = createStore();
        const session = new GitHubSourceSession(store);
        global.fetch = jest.fn(async (input) =>
            String(input).endsWith("/user") ? response({ id: 123 }) : response([], 503)
        );
        await session.connect("test-only-token");
        const source = store.getSources()[0];
        const oldCursor = { since: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString() };
        await store.saveSource({ ...source, cursor: oldCursor });
        await expect(session.sync()).rejects.toThrow();
        expect(store.getSources()[0].cursor).toEqual(oldCursor);
        expect((global.fetch as jest.Mock).mock.calls[1][0]).not.toContain("since=");
        await store.saveSource({ ...source, cursor: oldCursor, lastSyncedAt: new Date(now - 1000).toISOString() });
        await session.connect("test-only-token");
        await expect(session.sync()).rejects.toThrow();
        expect(store.getSources()[0].cursor).toEqual(oldCursor);
    });

    it("requests the full unread inbox on initial sync and retry regardless of legacy cursors", async () => {
        const now = Date.now();
        const clock = jest.spyOn(Date, "now").mockReturnValue(now);
        const { store } = createStore();
        const session = new GitHubSourceSession(store);
        const queries: string[] = [];
        global.fetch = jest.fn(async (input) => {
            const url = String(input);
            if (url.endsWith("/user")) return response({ id: 123 });
            queries.push(url);
            return response({}, 503);
        });
        await session.connect("test-only-token");
        await expect(session.sync()).rejects.toThrow("503");
        expect(store.getSources()[0].cursor).toBeUndefined();
        expect(store.getSources()[0].lastSyncedAt).toBeUndefined();
        expect(new URL(queries[0]).searchParams.has("since")).toBe(false);
        clock.mockReturnValue(now + 24 * 60 * 60 * 1000);
        await session.connect("test-only-token");
        await expect(session.sync()).rejects.toThrow("503");
        expect(queries[1]).toBe(queries[0]);
        // Legacy incremental cursors cannot restrict unread reconciliation.
        const source = store.getSources()[0];
        await store.saveSource({ ...source, cursor: { since: "2020-01-01T00:00:00.000Z" } });
        await session.connect("test-only-token");
        await expect(session.sync()).rejects.toThrow("503");
        expect(new URL(queries[2]).searchParams.has("since")).toBe(false);
    });

    it("does not let pending authentication undo a lock", async () => {
        const { store } = createStore();
        const session = new GitHubSourceSession(store);
        const authentication = gate();
        let signal: AbortSignal | undefined;
        global.fetch = jest.fn(async (_input, init) => {
            signal = init?.signal as AbortSignal;
            await authentication.promise;
            return response({ id: 123 });
        });
        const connecting = session.connect("test-only-token");
        session.lock();
        expect(signal?.aborted).toBe(true);
        authentication.resolve();
        await expect(connecting).rejects.toThrow("cancelled");
        expect(session.isUnlocked).toBe(false);
        expect(session.status.phase).toBe("locked");
    });

    it("starts a fresh sync on reconnect instead of joining a cancelled request", async () => {
        const { store } = createStore();
        const session = new GitHubSourceSession(store);
        const firstStarted = gate();
        const firstFinished = gate();
        let notificationRequests = 0;
        let oldSignal: AbortSignal | undefined;
        global.fetch = jest.fn(async (input, init) => {
            if (String(input).endsWith("/user")) return response({ id: 123 });
            notificationRequests++;
            if (notificationRequests === 1) {
                oldSignal = init?.signal as AbortSignal;
                firstStarted.resolve();
                // Simulate a slow transport that ignores cancellation.
                await firstFinished.promise;
                return response([notification("1")]);
            }
            return response([]);
        });
        await session.connect("old-test-token");
        const oldSync = session.sync();
        await firstStarted.promise;
        session.lock();
        await session.connect("new-test-token");
        await session.sync();
        expect(notificationRequests).toBe(2);
        expect(oldSignal?.aborted).toBe(true);
        const status = session.status;
        firstFinished.resolve();
        await oldSync;
        expect(store.getItems(GITHUB_SOURCE_ID)).toEqual([]);
        expect(session.status).toEqual(status);
        expect(session.isUnlocked).toBe(true);
    });

    it("publishes the unread snapshot before slow bodies and does not resurrect a concurrently read thread", async () => {
        const { store } = createStore();
        const session = new GitHubSourceSession(store);
        const releaseStarted = gate();
        const releaseFinished = gate();
        const onItemsSaved = jest.fn(async () => undefined);
        global.fetch = jest.fn(async (input, init) => {
            const url = String(input);
            if (url.endsWith("/user")) return response({ id: 123 });
            if (init?.method === "PUT") return response(undefined, 205);
            if (url.includes("notifications")) {
                return url.includes("page=2")
                    ? response([notification("2", "other/repo")])
                    : response([notification("1")], 200, {
                          Link: `<${url}&page=2>; rel="next"`
                      });
            }
            releaseStarted.resolve();
            await releaseFinished.promise;
            return response({ body: "Notes", html_url: "https://github.com/owner/repo/releases/tag/v1" });
        });
        await session.connect("test-only-token");
        const listener = jest.fn();
        const unsubscribe = session.subscribe(listener);
        const syncing = session.sync(onItemsSaved);
        await releaseStarted.promise;
        expect(store.getItems(GITHUB_SOURCE_ID)).toHaveLength(2);
        expect(store.getSources()[0].lastSyncedAt).toBeDefined();
        expect(store.getSources()[0].cursor).toEqual({ nextPollAt: expect.any(String) });
        expect(onItemsSaved).toHaveBeenCalledTimes(3);
        expect(session.status).toMatchObject({ phase: "syncing", pages: 2, notifications: 2, releases: 2 });
        const id = sourceItemId(GITHUB_SOURCE_ID, "1");
        await session.markRead([id]);
        releaseFinished.resolve();
        await syncing;
        expect(store.getItems(GITHUB_SOURCE_ID).map((item) => item.externalId)).toEqual(["2"]);
        expect(store.getItems(GITHUB_SOURCE_ID)[0].content).toBe("<p>Notes</p>\n");
        expect(store.getSources()[0].lastSyncedAt).toBeDefined();
        expect(session.status.phase).toBe("idle");
        expect(listener).toHaveBeenCalled();
        unsubscribe();
        listener.mockClear();
        session.lock();
        expect(listener).not.toHaveBeenCalled();
    });

    it("keeps checkpointed articles on page failure without advancing the cursor or hiding the HTTP error", async () => {
        const { store, storage } = createStore();
        const session = new GitHubSourceSession(store);
        global.fetch = jest.fn(async (input) => {
            const url = String(input);
            if (url.endsWith("/user")) return response({ id: 123 });
            if (url.includes("page=2")) return response({}, 403, { "Retry-After": "600" });
            return response([notification("1")], 200, {
                Link: `<${url}&page=2>; rel="next"`
            });
        });
        await session.connect("test-only-token");
        const onItemsSaved = jest.fn(async () => undefined);
        await expect(session.sync(onItemsSaved)).rejects.toThrow("403");
        expect(onItemsSaved).toHaveBeenCalledTimes(1);
        expect(session.status.phase).toBe("error");
        expect(session.status.message).toContain("HTTP 403");
        expect(session.status.message).toContain("Retry after");
        const reloaded = new SourceRepository(storage);
        await reloaded.ready();
        expect(reloaded.getItems(GITHUB_SOURCE_ID)).toHaveLength(1);
        expect(reloaded.getSources()[0]).not.toHaveProperty("lastSyncedAt");
        expect(reloaded.getSources()[0].cursor).toBeUndefined();
        const calls = (global.fetch as jest.Mock).mock.calls.length;
        await session.sync();
        expect(global.fetch).toHaveBeenCalledTimes(calls);
        expect(session.status.phase).toBe("error");
    });

    it("reports locked and polling waits instead of silently doing nothing, without exposing raw errors", async () => {
        const { store } = createStore();
        const session = new GitHubSourceSession(store);
        global.fetch = jest.fn(async (input) =>
            String(input).endsWith("/user") ? response({ id: 123 }) : response([])
        );
        await session.sync();
        expect(session.status.phase).toBe("locked");
        expect(global.fetch).not.toHaveBeenCalled();
        await session.connect("test-only-token");
        await session.sync();
        await session.sync();
        expect(session.status.phase).toBe("waiting");
        const source = store.getSources()[0];
        await store.saveSource({ ...source, cursor: undefined });
        global.fetch = jest.fn(async () => {
            throw new Error("private transport error with a token");
        });
        await expect(session.sync()).rejects.toThrow();
        expect(session.status.phase).toBe("error");
        expect(session.status.message).not.toContain("private transport");
        expect(session.status.message).not.toContain("test-only-token");
    });

    it("uses GitHub as the shared unread state across separate browser caches", async () => {
        const a = createStore();
        const b = createStore();
        const first = new GitHubSourceSession(a.store);
        const second = new GitHubSourceSession(b.store);
        let unread = [notification("1"), notification("2", "other/repo")];
        global.fetch = jest.fn(async (input, init) => {
            const url = String(input);
            if (url.endsWith("/user")) return response({ id: 123 });
            if (init?.method === "PUT") {
                expect(url).toBe("https://api.github.com/repos/owner/repo/notifications");
                unread = unread.filter((item) => item.id !== "1");
                return response(undefined, 205);
            }
            if (url.includes("/notifications?")) {
                expect(new URL(url).searchParams.has("since")).toBe(false);
                expect(init?.headers).not.toHaveProperty("If-Modified-Since");
                return response(unread);
            }
            return response({ body: "Notes" });
        });
        await first.connect("test-only-token");
        await second.connect("test-only-token");
        await first.sync();
        await second.sync();
        await first.markRead([sourceItemId(GITHUB_SOURCE_ID, "1")]);
        expect(a.store.getItems(GITHUB_SOURCE_ID).map((item) => item.externalId)).toEqual(["2"]);
        expect(b.store.getItems(GITHUB_SOURCE_ID)).toHaveLength(2);
        // Simulate the polling interval elapsing, keeping a legacy since value
        // to prove it cannot hide read changes made on another browser.
        await b.store.saveSource({ ...b.store.getSources()[0], cursor: { since: "2099-01-01T00:00:00Z" } });
        await second.sync();
        expect(b.store.getItems(GITHUB_SOURCE_ID).map((item) => item.externalId)).toEqual(["2"]);
        expect(global.fetch).toHaveBeenCalledWith(
            "https://api.github.com/repos/owner/repo/notifications",
            expect.objectContaining({
                method: "PUT",
                redirect: "error"
            })
        );
    });

    it("keeps failed repository writes unread and removes only successful acknowledgements", async () => {
        const { store } = createStore();
        const session = new GitHubSourceSession(store);
        const patched: string[] = [];
        global.fetch = jest.fn(async (input, init) => {
            const url = String(input);
            if (url.endsWith("/user")) return response({ id: 123 });
            if (init?.method === "PUT") {
                patched.push(url);
                return response(undefined, url.includes("/owner/repo/") ? 205 : 403);
            }
            if (url.includes("/notifications?"))
                return response([notification("1"), notification("2", "other/repo"), notification("3", "third/repo")]);
            return response({ body: "Notes" });
        });
        await session.connect("test-only-token");
        await session.sync();
        await expect(
            session.markRead([sourceItemId(GITHUB_SOURCE_ID, "1"), sourceItemId(GITHUB_SOURCE_ID, "2")])
        ).rejects.toThrow("403");
        expect(store.getItems(GITHUB_SOURCE_ID).map((item) => item.externalId)).toEqual(["2", "3"]);
        expect(patched).toEqual([
            "https://api.github.com/repos/owner/repo/notifications",
            "https://api.github.com/repos/other/repo/notifications"
        ]);
        expect(session.status.message).toContain("Failed notifications remain unread");
    });

    it("reconciles remote reads after complete pagination even when release notes fail", async () => {
        const { store } = createStore();
        const session = new GitHubSourceSession(store);
        let firstSync = true;
        global.fetch = jest.fn(async (input) => {
            const url = String(input);
            if (url.endsWith("/user")) return response({ id: 123 });
            if (url.includes("/notifications?")) return response([notification(firstSync ? "1" : "2")]);
            return firstSync ? response({ body: "Old notes" }) : response({}, 503);
        });
        await session.connect("test-only-token");
        await session.sync();
        firstSync = false;
        await store.saveSource({ ...store.getSources()[0], cursor: undefined });
        await expect(session.sync()).rejects.toThrow("503");
        expect(store.getItems(GITHUB_SOURCE_ID).map((item) => item.externalId)).toEqual(["2"]);
        expect(store.getSources()[0].lastSyncedAt).toBeDefined();
    });

    it("does not erase cached unread threads after an incomplete notification snapshot", async () => {
        const { store } = createStore();
        const session = new GitHubSourceSession(store);
        let firstSync = true;
        global.fetch = jest.fn(async (input) => {
            const url = String(input);
            if (url.endsWith("/user")) return response({ id: 123 });
            if (url.includes("page=2")) return response({}, 500);
            if (url.includes("/notifications?"))
                return firstSync
                    ? response([notification("1")])
                    : response([], 200, { Link: `<${url}&page=2>; rel="next"` });
            return response({ body: "Notes" });
        });
        await session.connect("test-only-token");
        await session.sync();
        firstSync = false;
        await store.saveSource({ ...store.getSources()[0], cursor: undefined });
        const previous = store.getSources()[0].lastSyncedAt;
        await expect(session.sync()).rejects.toThrow("500");
        expect(store.getItems(GITHUB_SOURCE_ID)).toHaveLength(1);
        expect(store.getSources()[0].lastSyncedAt).toBe(previous);
    });

    it("uses one repository PUT for 100 mixed notifications and preserves newer arrivals and other repositories", async () => {
        const { store } = createStore();
        const session = new GitHubSourceSession(store);
        const cutoff = "2026-01-01T00:00:00.000Z";
        const entries = Array.from({ length: 100 }, (_, index) => ({
            sourceId: GITHUB_SOURCE_ID,
            externalId: String(index),
            title: String(index),
            updatedAt: cutoff,
            metadata: { type: index % 2 ? "Issue" : "Release", repository: "owner/repo", githubUnread: true }
        }));
        const future = { ...entries[0], externalId: "future", updatedAt: "2026-01-02T00:00:00.000Z" };
        global.fetch = jest.fn(async (input, init) => {
            if (String(input).endsWith("/user")) return response({ id: 123 });
            expect(String(input)).toBe("https://api.github.com/repos/owner/repo/notifications");
            expect(init?.method).toBe("PUT");
            expect(JSON.parse(init?.body as string)).toEqual({ last_read_at: cutoff });
            // Another refresh updates an existing thread while the write is in flight.
            await store.saveItems(GITHUB_SOURCE_ID, [future, { ...entries[0], updatedAt: future.updatedAt }]);
            return response(undefined, 205);
        });
        await session.connect("test-only-token");
        await store.saveItems(GITHUB_SOURCE_ID, [
            ...entries,
            { ...entries[0], externalId: "other", metadata: { ...entries[0].metadata, repository: "other/repo" } }
        ]);
        await session.markRead(entries.map((item) => sourceItemId(GITHUB_SOURCE_ID, item.externalId)));
        expect((global.fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
        expect(store.getItems(GITHUB_SOURCE_ID).map((item) => item.externalId)).toEqual(["0", "other", "future"]);
    });

    it("keeps accepted 202 notifications until a later unread snapshot confirms completion", async () => {
        const { store } = createStore();
        const session = new GitHubSourceSession(store);
        global.fetch = jest.fn(async (input, init) => {
            if (String(input).endsWith("/user")) return response({ id: 123 });
            if (init?.method === "PUT") return response(undefined, 202);
            return response([]);
        });
        await session.connect("test-only-token");
        await store.saveItems(GITHUB_SOURCE_ID, [
            {
                sourceId: GITHUB_SOURCE_ID,
                externalId: "1",
                title: "Issue",
                updatedAt: "2026-01-01T00:00:00Z",
                metadata: { type: "Issue", repository: "owner/repo", githubUnread: true }
            }
        ]);
        await session.markRead([sourceItemId(GITHUB_SOURCE_ID, "1")]);
        expect(store.getItems(GITHUB_SOURCE_ID)).toHaveLength(1);
        expect(session.status.phase).toBe("waiting");
        await session.sync();
        expect(store.getItems(GITHUB_SOURCE_ID)).toEqual([]);
    });

    it("fails closed when a repository read cutoff is unknown", async () => {
        const { store } = createStore();
        const session = new GitHubSourceSession(store);
        global.fetch = jest.fn(async () => response({ id: 123 }));
        await session.connect("test-only-token");
        await store.saveItems(GITHUB_SOURCE_ID, [
            {
                sourceId: GITHUB_SOURCE_ID,
                externalId: "1",
                title: "Unknown timestamp",
                metadata: { type: "Issue", repository: "owner/repo" }
            }
        ]);
        await expect(session.markRead([sourceItemId(GITHUB_SOURCE_ID, "1")])).rejects.toThrow("timestamp");
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(store.getItems(GITHUB_SOURCE_ID)).toHaveLength(1);
    });
});
