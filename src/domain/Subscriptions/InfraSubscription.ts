// MIT © 2017 azu
import { Subscription } from "./Subscription";
import { MapLike } from "map-like";
// TODO: should be immutable m
let version = 0;

export class SubscriptionGroupByCategoryMap extends MapLike<string, Subscription[]> {
    get version() {
        return version;
    }

    versionUp() {
        version = version + 1;
    }

    sortedEntities(): Array<[string, Subscription[]]> {
        const sortedKeys = this.keys().sort();
        return sortedKeys.map((key) => {
            const subscriptions: Subscription[] = this.get(key) as Subscription[];
            return [key, subscriptions] as [string, Subscription[]];
        });
    }
}
