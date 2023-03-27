// MIT © 2017 azu
import { Entity, Identifier, Serializer } from "ddd-base";
import { SubscriptionContentBody } from "./SubscriptionContentBody";
import { TimeStamp, TimeStampJSON, TimeStampSerializer } from "../TimeStamp";
import { Enclosure } from "../../../infra/api/StreamContentsResponse";

export const SubscriptionContentSerializer: Serializer<SubscriptionContent, SubscriptionContentJSON> = {
    toJSON(entity) {
        return {
            id: entity.id.toValue(),
            author: entity.author,
            publishedDate: TimeStampSerializer.toJSON(entity.publishedDate),
            updatedDate: TimeStampSerializer.toJSON(entity.updatedDate),
            title: entity.title,
            body: entity.body.toJSON(),
            url: entity.url
        };
    },
    fromJSON(json) {
        return new SubscriptionContent({
            id: new SubscriptionContentIdentifier(json.id),
            author: json.author,
            publishedDate: TimeStampSerializer.fromJSON(json.publishedDate),
            updatedDate: TimeStampSerializer.fromJSON(json.updatedDate),
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
    publishedDate: TimeStampJSON;
    // if is not update, same with publishedDate
    updatedDate: TimeStampJSON;
    title: string;
    body: {
        content: string;
        enclosures?: Enclosure[];
    };
    url: string;
}

export class SubscriptionContentIdentifier extends Identifier<string> {}

export interface SubscriptionContentArgs {
    // See http://www.inoreader.com/developers/article-ids
    id: SubscriptionContentIdentifier;
    author: string;
    publishedDate: TimeStamp;
    // if is not update, same with publishedDate
    updatedDate: TimeStamp;
    title: string;
    body: SubscriptionContentBody;
    url: string;
}

export class SubscriptionContent extends Entity<SubscriptionContentArgs> {
    id: SubscriptionContentIdentifier;
    author: string;
    publishedDate: TimeStamp;
    // if is not update, same with publishedDate
    updatedDate: TimeStamp;
    title: string;
    body: SubscriptionContentBody;
    url: string;

    constructor(args: SubscriptionContentArgs) {
        super(args);
        this.id = args.id;
        this.author = args.author;
        this.publishedDate = args.publishedDate;
        this.updatedDate = args.updatedDate;
        this.title = args.title;
        this.body = args.body;
        this.url = args.url;
    }
}
