// MIT © 2017 azu
import { Entity, Identifier } from "ddd-base";
import { SubscriptionContentBody } from "./SubscriptionContentBody";

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
