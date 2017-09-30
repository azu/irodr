// MIT © 2017 azu
import { Subscription } from "../../domain/Subscriptions/Subscription";
import { NullableRepository } from "ddd-base";
import { splice } from "@immutable-array/prototype";

export class SubscriptionRepository extends NullableRepository<Subscription> {
    // Why not Map
    // Built-in Map is difficult to be immutable
    categoryMap: {
        [index: string]: Subscription[];
    };

    constructor() {
        super();
        this.categoryMap = {};
    }

    groupByCategory() {
        return this.categoryMap;
    }

    getAllCategoryNames() {
        return Object.keys(this.categoryMap);
    }

    getAllByCategories(category: string) {
        return this.categoryMap[category];
    }

    /**
     * Save subscriptions and build categories
     * @param {Subscription[]} subscriptions
     */
    saveBuild(subscriptions: Subscription[]) {}

    save(aSubscription: Subscription) {
        super.save(aSubscription);
        aSubscription.categories.forEach(category => {
            if (this.categoryMap[category] !== undefined) {
                const subscriptions = this.categoryMap[category];
                const index = subscriptions.findIndex(subscription => subscription.equals(aSubscription));
                if (index === -1) {
                    this.categoryMap = {
                        ...this.categoryMap,
                        [category]: subscriptions.concat(aSubscription)
                    };
                } else {
                    // replace
                    this.categoryMap = {
                        ...this.categoryMap,
                        [category]: splice(subscriptions, index, 1, aSubscription)
                    };
                }
            } else {
                this.categoryMap = {
                    ...this.categoryMap,
                    [category]: [aSubscription]
                };
            }
        });
    }
}
