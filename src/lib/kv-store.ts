/** Asynchronous key-value storage. */
export interface KeyValueStore {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
}

// localforage's IndexedDB layout, so data written by irodr 1.x stays readable.
const OBJECT_STORE = "keyvaluepairs";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
}

function openDatabase(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(OBJECT_STORE)) {
                request.result.createObjectStore(OBJECT_STORE);
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            if (db.objectStoreNames.contains(OBJECT_STORE)) {
                resolve(db);
                return;
            }
            // The database exists without our store: add it in a new version.
            const version = db.version + 1;
            db.close();
            const upgrade = indexedDB.open(name, version);
            upgrade.onupgradeneeded = () => upgrade.result.createObjectStore(OBJECT_STORE);
            upgrade.onsuccess = () => resolve(upgrade.result);
            upgrade.onerror = () => reject(upgrade.error ?? new Error("IndexedDB upgrade failed"));
        };
        request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    });
}

export function createIndexedDBStore(name: string): KeyValueStore {
    let database: Promise<IDBDatabase> | undefined;
    const db = () => {
        database ??= openDatabase(name).catch((error: unknown) => {
            database = undefined;
            throw error;
        });
        return database;
    };
    const run = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) => {
        const store = (await db()).transaction(OBJECT_STORE, mode).objectStore(OBJECT_STORE);
        return promisify(action(store));
    };
    return {
        async get<T>(key: string) {
            const value = await run("readonly", (store) => store.get(key));
            return (value ?? undefined) as T | undefined;
        },
        async set(key, value) {
            await run("readwrite", (store) => store.put(value, key));
        },
        async delete(key) {
            await run("readwrite", (store) => store.delete(key));
        }
    };
}

export function createMemoryStore(initial: Record<string, unknown> = {}): KeyValueStore {
    const map = new Map(Object.entries(initial));
    return {
        async get<T>(key: string) {
            return structuredClone(map.get(key)) as T | undefined;
        },
        async set(key, value) {
            map.set(key, structuredClone(value));
        },
        async delete(key) {
            map.delete(key);
        }
    };
}

/** Serializes read-modify-write cycles across tabs where Web Locks are available. */
export type WriteLock = <T>(name: string, write: () => Promise<T>) => Promise<T>;

export const browserWriteLock: WriteLock = (name, write) =>
    typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request(name, write) : write();

export const noWriteLock: WriteLock = (_name, write) => write();
