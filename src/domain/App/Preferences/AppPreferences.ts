// MIT © 2017 azu

import { Serializer } from "ddd-base";

export const AppPreferencesSerializer: Serializer<AppPreferences, AppPreferencesJSON> = {
    toJSON(entity) {
        return {
            ...entity
        };
    },
    fromJSON(json) {
        return new AppPreferences({
            ...DefaultAppPreferences,
            ...json
        });
    }
};

export interface AppPreferencesJSON {
    // Number of prefetch subscription
    prefetchSubscriptionCount: number;
    // Number of fetch subscription contents(items)
    fetchContentsCount: number;
    // Is enable auto refresh?
    enableAutoRefreshSubscription: boolean;
    // Time of auto refresh subscription(second)
    autoRefreshSubscriptionSec: number;
}

export const DefaultAppPreferences: AppPreferencesJSON = {
    fetchContentsCount: 20,
    prefetchSubscriptionCount: 5,
    enableAutoRefreshSubscription: true,
    autoRefreshSubscriptionSec: 120
};

export class AppPreferences {
    // Number of prefetch subscription
    prefetchSubscriptionCount: number;
    // Number of fetch subscription contents(items)
    fetchContentsCount: number;
    // Is enable auto refresh?
    enableAutoRefreshSubscription: boolean;
    // Time of auto refresh subscription(second)
    autoRefreshSubscriptionSec: number;

    constructor(args: AppPreferencesJSON) {
        this.prefetchSubscriptionCount = args.prefetchSubscriptionCount;
        this.enableAutoRefreshSubscription = args.enableAutoRefreshSubscription;
        this.autoRefreshSubscriptionSec = args.autoRefreshSubscriptionSec;
    }

    update(newArgs: Partial<AppPreferencesJSON>): AppPreferences {
        return new AppPreferences({
            ...this as AppPreferencesJSON,
            ...newArgs
        });
    }
}
