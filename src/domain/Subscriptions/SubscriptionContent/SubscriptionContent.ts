// MIT © 2017 azu
import { Entity, Identifier, Serializer } from "ddd-base";
import { SubscriptionContentBody } from "./SubscriptionContentBody";

export const SubscriptionContentSerializer: Serializer<SubscriptionContent, SubscriptionContentJSON> = {
    toJSON(entity) {
        return {
            id: entity.id.toValue(),
            author: entity.author,
            publishedDate: entity.publishedDate.toISOString(),
            updatedDate: entity.updatedDate.toISOString(),
            title: entity.title,
            body: entity.body.HTMLString,
            url: entity.url
        };
    },
    fromJSON(json) {
        return new SubscriptionContent({
            id: new SubscriptionContentIdentifier(json.id),
            author: json.author,
            publishedDate: new Date(json.publishedDate),
            updatedDate: new Date(json.updatedDate),
            title: json.title,
            body: new SubscriptionContentBody(json.body),
            url: json.url
        });
    }
};

export interface SubscriptionContentJSON {
    // See http://www.inoreader.com/developers/article-ids
    id: string;
    author: string;
    // ISO 8601
    publishedDate: string;
    // ISO 8601
    // if is not update, same with publishedDate
    updatedDate: string;
    title: string;
    body: string;
    url: string;
}

export class SubscriptionContentIdentifier extends Identifier<string> {}

export interface SubscriptionContentArgs {
    // See http://www.inoreader.com/developers/article-ids
    id: SubscriptionContentIdentifier;
    author: string;
    publishedDate: Date;
    // if is not update, same with publishedDate
    updatedDate: Date;
    title: string;
    body: SubscriptionContentBody;
    url: string;
}

export class SubscriptionContent extends Entity<SubscriptionContentIdentifier> {
    id: SubscriptionContentIdentifier;
    author: string;
    publishedDate: Date;
    // if is not update, same with publishedDate
    updatedDate: Date;
    title: string;
    body: SubscriptionContentBody;
    url: string;

    constructor(args: SubscriptionContentArgs) {
        super(args.id);
        this.id = args.id;
        this.author = args.author;
        this.publishedDate = args.publishedDate;
        this.updatedDate = args.updatedDate;
        this.title = args.title;
        this.body = args.body;
        this.url = args.url;
    }
}
