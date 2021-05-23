// MIT © 2017 azu
import { SubscriptionResponse, SubscriptionsResponse } from "../../infra/api/SubscriptionResponse";
import { Subscription, SubscriptionIdentifier } from "./Subscription";
import { SubscriptionUnread } from "./SubscriptionUnread";
import { UnreadCountResponse, UnreadCountsResponse } from "../../infra/api/UnreadCountResponse";
import keyBy from "lodash.keyby";
import { TimeStamp } from "./TimeStamp";
import { NullSubscriptionContents } from "./SubscriptionContent/NullSubscriptionContents";

export function createSubscriptionsFromResponses(
    subscriptionsResponse: SubscriptionsResponse,
    unreadsResponse: UnreadCountsResponse
): Subscription[] {
    const unreadCountsById = keyBy(unreadsResponse.unreadcounts, "id");
    const results: Subscription[] = [];
    subscriptionsResponse.subscriptions.forEach((subscriptionResponse) => {
        const unreadCountResponse: UnreadCountResponse | undefined = unreadCountsById[subscriptionResponse.id];
        if (unreadCountResponse) {
            results.push(createSubscriptionFromResponse(subscriptionResponse, unreadCountResponse));
        } else {
            console.warn(`${subscriptionResponse.id}に対応するunreadCountResponseがない`, unreadCountResponse);
        }
    });
    return results;
}

export function createSubscriptionFromResponse(
    subscriptionResponse: SubscriptionResponse,
    unreadResponse: UnreadCountResponse
): Subscription {
    return new Subscription({
        id: new SubscriptionIdentifier(subscriptionResponse.id),
        title: subscriptionResponse.title,
        url: subscriptionResponse.url,
        iconUrl: subscriptionResponse.iconUrl,
        htmlUrl: subscriptionResponse.htmlUrl,
        lastUpdated: TimeStamp.createTimeStampFromMicrosecond(subscriptionResponse.firstitemmsec),
        categories: subscriptionResponse.categories.map((category) => category.label),
        contents: new NullSubscriptionContents(),
        unread: new SubscriptionUnread({
            count: Number(unreadResponse.count),
            maxCount: 1000,
            // last read time
            readTimestamp: TimeStamp.createTimeStampFromMicrosecond(subscriptionResponse.firstitemmsec)
        }),
        isContentsUpdating: false
    });
}
