// MIT © 2017 azu
import { Entity, Identifier, Serializer } from "ddd-base";
import { SubscriptionOrder } from "./SubscriptionOrder";
import { SubscriptionUnread, SubscriptionUnreadJSON, SubscriptionUnreadSerializer } from "./SubscriptionUnread";
import {
    SubscriptionContents,
    SubscriptionContentsJSON,
    SubscriptionContentsSerializer
} from "./SubscriptionContent/SubscriptionContents";
import { TimeStamp, TimeStampJSON, TimeStampSerializer } from "./TimeStamp";

export const SubscriptionSerializer: Serializer<Subscription, SubscriptionJSON> = {
    toJSON(entity) {
        return {
            id: entity.id.toValue(),
            title: entity.title,
            url: entity.url,
            iconUrl: entity.iconUrl,
            htmlUrl: entity.htmlUrl,
            categories: entity.categories,
            contents: SubscriptionContentsSerializer.toJSON(entity.contents),
            unread: SubscriptionUnreadSerializer.toJSON(entity.unread),
            lastUpdated: TimeStampSerializer.toJSON(entity.lastUpdated)
        };
    },
    fromJSON(json) {
        return new Subscription({
            id: new SubscriptionIdentifier(json.id),
            title: json.title,
            url: json.url,
            iconUrl: json.iconUrl,
            htmlUrl: json.htmlUrl,
            categories: json.categories,
            order: new SubscriptionOrder(),
            contents: SubscriptionContentsSerializer.fromJSON(json.contents),
            unread: SubscriptionUnreadSerializer.fromJSON(json.unread),
            lastUpdated: TimeStampSerializer.fromJSON(json.lastUpdated),
            isContentsUpdating: false
        });
    }
};

export interface SubscriptionJSON {
    id: string;
    title: string;
    url: string;
    iconUrl: string;
    htmlUrl: string;
    categories: string[];
    contents: SubscriptionContentsJSON;
    // order: SubscriptionOrder;
    unread: SubscriptionUnreadJSON;
    lastUpdated: TimeStampJSON;
}

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
    lastUpdated: TimeStamp;
    isContentsUpdating: boolean;
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
    lastUpdated: TimeStamp;
    isContentsUpdating: boolean;

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
        this.isContentsUpdating = args.isContentsUpdating;
    }

    get hasUnreadContents(): boolean {
        return this.unread.count > 0;
    }

    readAll() {
        return new Subscription({
            ...this as SubscriptionArgs,
            unread: this.unread.read()
        });
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

    mutableBeginContentUpdating() {
        this.isContentsUpdating = true;
    }

    mutableEndContentUpdating() {
        this.isContentsUpdating = false;
    }
}
