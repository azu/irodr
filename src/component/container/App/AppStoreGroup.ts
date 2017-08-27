// MIT © 2017 azu
import { StoreGroup } from "almin";
import { SubscriptionListStore } from "./Subscription/SubscriptionList/SubscriptionListStore";
import { subscriptionRepository } from "../../../infra/repository/SubscriptionRepository";
import { SubscriptionContentsStore } from "./Subscription/SubscriptionContents/SubscriptionContentsStore";

export const appStoreGroup = new StoreGroup({
    subscriptionList: new SubscriptionListStore({
        subscriptionRepository
    }),
    subscriptionContents: new SubscriptionContentsStore({
        subscriptionRepository
    })
});
