// MIT © 2017 azu
import { Entity, Identifier } from "ddd-base";
import { SubscriptionOrder } from "./SubscriptionOrder";
import { SubscriptionUnread } from "./SubscriptionUnread";
import { SubscriptionContents } from "./SubscriptionContent/SubscriptionContents";
import { SubscriptionLastUpdated } from "./SubscriptionLastUpdated";

export class SubscriptionIdentifier extends Identifier<string> {}

export interface SubscriptionArgs {
    id: SubscriptionIdentifier;
    title: string;
    url: string;
    iconUrl: string;
    htmlUrl: string;
    categories: string[];
    contents: SubscriptionContents;
    order: SubscriptionOrder;
    unread: SubscriptionUnread;
    lastUpdated: SubscriptionLastUpdated;
}

export class Subscription extends Entity<SubscriptionIdentifier> {
    title: string;
    url: string;
    iconUrl: string;
    htmlUrl: string;
    categories: string[];
    contents: SubscriptionContents;
    order: SubscriptionOrder;
    unread: SubscriptionUnread;
    lastUpdated: SubscriptionLastUpdated;

    constructor(args: SubscriptionArgs) {
        super(args.id);
        this.title = args.title;
        this.url = args.url;
        this.iconUrl = args.iconUrl;
        this.htmlUrl = args.htmlUrl;
        this.contents = args.contents;
        this.categories = args.categories;
        this.order = args.order;
        this.unread = args.unread;
        this.lastUpdated = args.lastUpdated;
    }

    get hasUnreadContents(): boolean {
        return this.unread.count > 0;
    }

    refreshSubscription(subscriptionArgs: Partial<SubscriptionArgs>) {
        return new Subscription({
            ...this as SubscriptionArgs,
            ...subscriptionArgs
        });
    }

    updateContents(subscriptionContents: SubscriptionContents) {
        return new Subscription({
            ...this as SubscriptionArgs,
            contents: subscriptionContents
        });
    }
}
