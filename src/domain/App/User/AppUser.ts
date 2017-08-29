// MIT © 2017 azu
import { Entity, Identifier, Serializer } from "ddd-base";
import { AppSubscriptionActivity } from "./AppSubscriptionActivity";
import { Subscription } from "../../Subscriptions/Subscription";
import { createAppUser } from "./AppUserFactory";

// TODO: implement
export const AppUserSerializer: Serializer<AppUser, AppUserJSON> = {
    toJSON(entity) {
        return {};
    },
    fromJSON(json) {
        return createAppUser();
    }
};

export interface AppUserJSON {}

export class AppUserIdentifier extends Identifier<string> {}

export interface AppUserArgs {
    id: AppUserIdentifier;
    subscriptionActivity: AppSubscriptionActivity;
}

export class AppUser extends Entity<AppUserIdentifier> {
    id: AppUserIdentifier;
    subscriptionActivity: AppSubscriptionActivity;

    constructor(args: AppUserArgs) {
        super(args.id);
        this.subscriptionActivity = args.subscriptionActivity;
    }

    openNewSubscription(subscription: Subscription) {
        this.subscriptionActivity = this.subscriptionActivity.addItem(subscription);
    }
}
