// MIT © 2017 azu
import { ValueObject } from "ddd-base";

export interface SubscriptionUnreadArgs {
    count: number;
    maxCount: number;
}

export class SubscriptionUnread extends ValueObject {
    count: number;
    maxCount: number = 1000;

    constructor(args: SubscriptionUnreadArgs) {
        super();
        this.count = args.count;
        this.maxCount = args.maxCount;
    }

    get formatString() {
        if (this.maxCount < this.count) {
            return String(`${this.count}+`);
        }
        return String(this.count);
    }
}
