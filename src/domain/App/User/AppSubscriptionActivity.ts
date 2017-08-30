// MIT © 2017 azu
import { AppSubscriptionActivityItem } from "./AppSubscriptionActivityItem";
import { SubscriptionIdentifier } from "../../Subscriptions/Subscription";

export interface AppSubscriptionActivityArgs {
    items: AppSubscriptionActivityItem[];
}

export class AppSubscriptionActivity {
    items: AppSubscriptionActivityItem[];

    constructor(args: AppSubscriptionActivityArgs) {
        this.items = args.items;
    }

    isReadRecently(subscriptionId: SubscriptionIdentifier): boolean {
        const RECENT = 3;
        return this.items.slice(-RECENT).some(item => subscriptionId.equals(item.id));
    }

    get current(): AppSubscriptionActivityItem | undefined {
        return this.items[this.items.length - 1];
    }

    get currentId(): SubscriptionIdentifier | undefined {
        return this.current ? this.current.id : undefined;
    }

    addItem(item: AppSubscriptionActivityItem) {
        return new AppSubscriptionActivity({
            ...this as AppSubscriptionActivityArgs,
            items: this.items.concat(item)
        });
    }
}
