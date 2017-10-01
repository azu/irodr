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
    isMachine: boolean;
    subscriptionActivity: AppSubscriptionActivity;
}

export class AppUser extends Entity<AppUserIdentifier> {
    id: AppUserIdentifier;
    readonly isMachine: boolean;
    subscriptionActivity: AppSubscriptionActivity;

    constructor(args: AppUserArgs) {
        super(args.id);
        this.isMachine = args.isMachine;
        this.subscriptionActivity = args.subscriptionActivity;
    }

    openNewSubscription(subscription: Subscription) {
        this.subscriptionActivity = this.subscriptionActivity.addItem(subscription);
    }
}
