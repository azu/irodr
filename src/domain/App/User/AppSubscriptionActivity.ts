// MIT © 2017 azu
import { AppSubscriptionActivityItem } from "./AppSubscriptionActivityItem";

export interface AppSubscriptionActivityArgs {
    items: AppSubscriptionActivityItem[];
}

export class AppSubscriptionActivity {
    items: AppSubscriptionActivityItem[];

    constructor(args: AppSubscriptionActivityArgs) {
        this.items = args.items;
    }

    get current(): AppSubscriptionActivityItem | undefined {
        return this.items[this.items.length - 1];
    }

    addItem(item: AppSubscriptionActivityItem) {
        return new AppSubscriptionActivity({
            ...this as AppSubscriptionActivityArgs,
            items: this.items.concat(item)
        });
    }
}
