// MIT © 2017 azu
import { ValueObject } from "ddd-base";
import { SubscriptionIdentifier } from "../../Subscriptions/Subscription";

export interface AppSubscriptionActivityItemArgs {
    id: SubscriptionIdentifier;
}

export class AppSubscriptionActivityItem extends ValueObject {
    id: SubscriptionIdentifier;

    constructor(args: AppSubscriptionActivityItemArgs) {
        super();
        this.id = args.id;
    }
}
