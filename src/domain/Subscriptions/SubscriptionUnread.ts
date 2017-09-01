// MIT © 2017 azu
import { Serializer, ValueObject } from "ddd-base";
import { TimeStamp, TimeStampSerializer } from "./TimeStamp";

export const SubscriptionUnreadSerializer: Serializer<SubscriptionUnread, SubscriptionUnreadJSON> = {
    fromJSON(json) {
        return new SubscriptionUnread({
            count: json.count,
            maxCount: json.maxCount,
            readTimestamp: TimeStampSerializer.fromJSON(json.readTimestamp)
        });
    },
    toJSON(entity) {
        return {
            count: entity.count,
            maxCount: entity.maxCount,
            readTimestamp: TimeStampSerializer.toJSON(entity.readTimestamp)
        };
    }
};

export interface SubscriptionUnreadJSON {
    count: number;
    maxCount: number;
    readTimestamp: number;
}

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
            readTimestamp: timeStamp ? timeStamp : TimeStamp.now()
        });
    }

    get formatString() {
        if (this.maxCount < this.count) {
            return String(`${this.count}+`);
        }
        return String(this.count);
    }
}
