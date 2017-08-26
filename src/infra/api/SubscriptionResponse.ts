// MIT © 2017 azu
// http://www.inoreader.com/developers/subscription-list
// http://www.inoreader.com/developers/stream-ids
export interface Category {
    id: string;
    label: string;
}

export interface SubscriptionResponse {
    iconUrl: string;
    firstitemmsec: number;
    categories: Category[];
    htmlUrl: string;
    sortid: string;
    // id is feed id
    // it is also stream id
    id: string;
    title: string;
    url: string;
}

export interface SubscriptionsResponse {
    subscriptions: SubscriptionResponse[];
}
