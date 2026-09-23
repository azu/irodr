import { describe, expect, it } from "vite-plus/test";
import {
    DEFAULT_PREFERENCES,
    legacyPreferences,
    loadPreferences,
    normalizePreferences,
    savePreferences
} from "./preferences.ts";

describe("preferences", () => {
    it("falls back to defaults for missing or invalid values", () => {
        expect(normalizePreferences({})).toEqual(DEFAULT_PREFERENCES);
        expect(
            normalizePreferences({
                fetchContentsCount: 500,
                prefetchSubscriptionCount: -1,
                autoRefreshSubscriptionSec: "x"
            })
        ).toEqual({
            ...DEFAULT_PREFERENCES,
            fetchContentsCount: 100,
            prefetchSubscriptionCount: 0
        });
    });

    it("round-trips through storage", () => {
        const values = new Map<string, string>();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => void values.set(key, value)
        };
        savePreferences(storage, { ...DEFAULT_PREFERENCES, prefetchSubscriptionCount: 2 });
        expect(loadPreferences(storage).prefetchSubscriptionCount).toBe(2);
        values.set("irodr:preferences", "{broken");
        expect(loadPreferences(storage)).toEqual(DEFAULT_PREFERENCES);
    });

    it("reads irodr 1.x preferences", () => {
        const record = {
            id: "01H",
            user: { id: "u" },
            preferences: {
                prefetchSubscriptionCount: 0,
                fetchContentsCount: 50,
                enableAutoRefreshSubscription: false,
                autoRefreshSubscriptionSec: 300
            }
        };
        expect(legacyPreferences([record])).toEqual(record.preferences);
        expect(legacyPreferences([])).toBeUndefined();
        expect(legacyPreferences([null, "x"])).toBeUndefined();
    });
});
