export interface Preferences {
    /** Number of following feeds to prefetch after opening a feed. */
    readonly prefetchSubscriptionCount: number;
    /** Number of items to load per page. */
    readonly fetchContentsCount: number;
    readonly enableAutoRefreshSubscription: boolean;
    /** Seconds between automatic refreshes. */
    readonly autoRefreshSubscriptionSec: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
    prefetchSubscriptionCount: 5,
    fetchContentsCount: 20,
    enableAutoRefreshSubscription: true,
    autoRefreshSubscriptionSec: 120
};

const KEY = "irodr:preferences";

function integer(value: unknown, fallback: number, min: number, max: number): number {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function normalizePreferences(value: Partial<Record<keyof Preferences, unknown>>): Preferences {
    return {
        prefetchSubscriptionCount: integer(
            value.prefetchSubscriptionCount,
            DEFAULT_PREFERENCES.prefetchSubscriptionCount,
            0,
            50
        ),
        // Inoreader returns at most 100 items per request.
        fetchContentsCount: integer(value.fetchContentsCount, DEFAULT_PREFERENCES.fetchContentsCount, 1, 100),
        enableAutoRefreshSubscription:
            typeof value.enableAutoRefreshSubscription === "boolean"
                ? value.enableAutoRefreshSubscription
                : DEFAULT_PREFERENCES.enableAutoRefreshSubscription,
        autoRefreshSubscriptionSec: integer(
            value.autoRefreshSubscriptionSec,
            DEFAULT_PREFERENCES.autoRefreshSubscriptionSec,
            1,
            24 * 60 * 60
        )
    };
}

export function loadPreferences(storage: Pick<Storage, "getItem">): Preferences {
    try {
        return normalizePreferences(JSON.parse(storage.getItem(KEY) ?? "{}") as Partial<Preferences>);
    } catch {
        return DEFAULT_PREFERENCES;
    }
}

export function savePreferences(storage: Pick<Storage, "setItem">, preferences: Preferences): void {
    try {
        storage.setItem(KEY, JSON.stringify(preferences));
    } catch {
        // Storage may be full or disabled; preferences still apply to this session.
    }
}
