import type { WebStorage } from "./oauth.ts";

/** An in-memory Web Storage, like localStorage and sessionStorage. Tests use it in place of the browser's. */
export function createMemoryStorage(): WebStorage {
    const values = new Map<string, string>();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
            values.set(key, value);
        },
        removeItem: (key) => {
            values.delete(key);
        }
    };
}
