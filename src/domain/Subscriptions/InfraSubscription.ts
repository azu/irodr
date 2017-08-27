// MIT © 2017 azu
import { Subscription } from "./Subscription";
import { MapLike } from "map-like";

export class SubscriptionGroupByCategoryMap extends MapLike<string, Subscription[]> {
    sortedEntities(): Array<[string, Subscription[]]> {
        const sortedKeys = this.keys().sort();
        const results = sortedKeys.map(key => {
            const subscriptions: Subscription[] = this.get(key) as Subscription[];
            return [key, subscriptions] as [string, Subscription[]];
        });
        return results;
    }
}
