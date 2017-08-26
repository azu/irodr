// MIT © 2017 azu
export interface UnreadCountsResponse {
    max: string;
    unreadcounts: UnreadCountResponse[];
}

export interface UnreadCountResponse {
    id: string;
    count: number | string;
    newestItemTimestampUsec: string;
}
