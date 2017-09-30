// MIT © 2017 azu
import { SubscriptionContents } from "./SubscriptionContents";
import { TimeStamp } from "../TimeStamp";

export class NullSubscriptionContents extends SubscriptionContents {
    constructor() {
        super({
            contents: [],
            lastUpdatedTimestamp: new TimeStamp(0)
        });
    }
}
