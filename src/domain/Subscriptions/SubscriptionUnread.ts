// MIT © 2017 azu
import { ValueObject } from "ddd-base";
import { TimeStamp } from "./TimeStamp";

export interface SubscriptionUnreadArgs {
    count: number;
    maxCount: number;
    readTimestamp: TimeStamp;
}

export class SubscriptionUnread extends ValueObject {
    count: number;
    maxCount: number = 1000;
    readTimestamp: TimeStamp;

    constructor(args: SubscriptionUnreadArgs) {
        super();
        this.count = args.count;
        this.maxCount = args.maxCount;
        this.readTimestamp = args.readTimestamp;
    }

    read(timeStamp?: TimeStamp) {
        return new SubscriptionUnread({
            ...this as SubscriptionUnreadArgs,
            count: 0,
            readTimestamp: timeStamp ? timeStamp : TimeStamp.createTimeStampFromSecond(Date.now())
        });
    }

    get formatString() {
        if (this.maxCount < this.count) {
            return String(`${this.count}+`);
        }
        return String(this.count);
    }
}
