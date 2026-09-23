// Inoreader API responses. See https://www.inoreader.com/developers/

export interface InoreaderCategory {
    id: string;
    label: string;
}

/** https://www.inoreader.com/developers/subscription-list */
export interface SubscriptionResponse {
    /** Stream ID, e.g. `feed/https://example.com/rss` */
    id: string;
    title: string;
    categories: InoreaderCategory[];
    sortid?: string;
    /** Microseconds. Articles older than this cannot be marked unread. */
    firstitemmsec?: number;
    url: string;
    htmlUrl: string;
    iconUrl: string;
}

export interface SubscriptionsResponse {
    subscriptions: SubscriptionResponse[];
}

/** https://www.inoreader.com/developers/unread-counts */
export interface UnreadCountResponse {
    id: string;
    count: number | string;
    /** Microseconds, as a string. */
    newestItemTimestampUsec: string;
}

export interface UnreadCountsResponse {
    max: string | number;
    unreadcounts: UnreadCountResponse[];
}

export interface Enclosure {
    href: string;
    type?: string;
    length?: string;
}

/** https://www.inoreader.com/developers/stream-contents */
export interface StreamItemResponse {
    id: string;
    title: string;
    /** Seconds. Missing for some items. */
    published?: number;
    /** Seconds. 0 or absent when never updated. */
    updated?: number;
    /** Microseconds, as a string. Used by mark-all-as-read. */
    timestampUsec: string;
    crawlTimeMsec?: string;
    categories?: string[];
    canonical?: { href: string }[];
    alternate?: { href: string; type?: string }[];
    enclosure?: Enclosure[];
    author?: string;
    summary?: { content: string; direction?: string };
    origin?: { streamId: string; title: string; htmlUrl: string };
}

export interface StreamContentsResponse {
    id: string;
    title?: string;
    /** Seconds. */
    updated?: number;
    continuation?: string;
    items: StreamItemResponse[];
}

/** https://www.inoreader.com/developers/oauth */
export interface TokenResponse {
    access_token: string;
    token_type?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
}
