// Inoreader API responses. See https://www.inoreader.com/developers/

export interface InoreaderCategory {
    readonly id: string;
    readonly label: string;
}

/** https://www.inoreader.com/developers/subscription-list */
export interface SubscriptionResponse {
    /** Stream ID, e.g. `feed/https://example.com/rss` */
    readonly id: string;
    readonly title: string;
    readonly categories: readonly InoreaderCategory[];
    readonly sortid?: string;
    /** Microseconds. Articles older than this cannot be marked unread. */
    readonly firstitemmsec?: number;
    readonly url: string;
    readonly htmlUrl: string;
    readonly iconUrl: string;
}

export interface SubscriptionsResponse {
    readonly subscriptions: readonly SubscriptionResponse[];
}

/** https://www.inoreader.com/developers/unread-counts */
export interface UnreadCountResponse {
    readonly id: string;
    readonly count: number | string;
    /** Microseconds, as a string. */
    readonly newestItemTimestampUsec: string;
}

export interface UnreadCountsResponse {
    readonly max: string | number;
    readonly unreadcounts: readonly UnreadCountResponse[];
}

export interface Enclosure {
    readonly href: string;
    readonly type?: string;
    readonly length?: string;
}

/** https://www.inoreader.com/developers/stream-contents */
export interface StreamItemResponse {
    readonly id: string;
    readonly title: string;
    /** Seconds. Missing for some items. */
    readonly published?: number;
    /** Seconds. 0 or absent when never updated. */
    readonly updated?: number;
    /** Microseconds, as a string. Used by mark-all-as-read. */
    readonly timestampUsec: string;
    readonly crawlTimeMsec?: string;
    readonly categories?: readonly string[];
    readonly canonical?: readonly { readonly href: string }[];
    readonly alternate?: readonly { readonly href: string; readonly type?: string }[];
    readonly enclosure?: readonly Enclosure[];
    readonly author?: string;
    readonly summary?: { readonly content: string; readonly direction?: string };
    readonly origin?: { readonly streamId: string; readonly title: string; readonly htmlUrl: string };
}

export interface StreamContentsResponse {
    readonly id: string;
    readonly title?: string;
    /** Seconds. */
    readonly updated?: number;
    readonly continuation?: string;
    readonly items: readonly StreamItemResponse[];
}

/** https://www.inoreader.com/developers/oauth */
export interface TokenResponse {
    readonly access_token: string;
    readonly token_type?: string;
    readonly expires_in?: number;
    readonly refresh_token?: string;
    readonly scope?: string;
}
