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
        const RECENT = 5;
        return this.items.slice(-RECENT).some((item) => subscriptionId.equals(item.id));
    }

    get previousItem(): AppSubscriptionActivityItem | undefined {
        return this.items[this.items.length - 2];
    }

    get currentItem(): AppSubscriptionActivityItem | undefined {
        return this.items[this.items.length - 1];
    }

    addItem(item: AppSubscriptionActivityItem) {
        // Reselecting a feed is not navigation. Duplicate adjacent entries would
        // otherwise make "skip" remove only one copy and still mark that feed read.
        if (this.currentItem?.id.equals(item.id)) {
            return this;
        }
        return new AppSubscriptionActivity({
            ...(this as AppSubscriptionActivityArgs),
            items: this.items.concat(item)
        });
    }

    removeCurrentItem() {
        return new AppSubscriptionActivity({
            ...(this as AppSubscriptionActivityArgs),
            items: this.items.slice(0, -1)
        });
    }
}
