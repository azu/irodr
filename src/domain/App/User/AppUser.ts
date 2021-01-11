// MIT © 2017 azu
import { Entity, Identifier, Serializer } from "ddd-base";
import { AppSubscriptionActivity } from "./AppSubscriptionActivity";
import { Subscription } from "../../Subscriptions/Subscription";
import { defaultAppUserArgs } from "./AppUserFactory";
import {
    InoreaderAuthority,
    InoreaderAuthorityJSON,
    InoreaderAuthoritySerializer
} from "../Authority/InoreaderAuthority";
import { Authority } from "../Authority/Authority";
import { AppSubscriptionActivityItem } from "./AppSubscriptionActivityItem";

// Limited Implementation
export const AppUserSerializer: Serializer<AppUser, AppUserJSON> = {
    toJSON(entity) {
        return {
            id: entity.id.toValue(),
            authority: InoreaderAuthoritySerializer.toJSON(entity.authority)
        };
    },
    fromJSON(json) {
        return new AppUser({
            ...defaultAppUserArgs(false),
            id: new AppUserIdentifier(json.id),
            authority: InoreaderAuthoritySerializer.fromJSON(json.authority)
        });
    }
};

export interface AppUserJSON {
    id: string;
    authority: InoreaderAuthorityJSON;
}

export class AppUserIdentifier extends Identifier<string> {}

export interface AppUserArgs {
    id: AppUserIdentifier;
    authority: Authority;
    isMachine: boolean;
    subscriptionActivity: AppSubscriptionActivity;
}

export class AppUser extends Entity<AppUserArgs> {
    id: AppUserIdentifier;
    // user include authority
    // It has a limitation that one user has a one authority.
    authority: Authority;
    readonly isMachine: boolean;
    subscriptionActivity: AppSubscriptionActivity;

    constructor(args: AppUserArgs) {
        super(args);
        this.id = args.id;
        this.isMachine = args.isMachine;
        this.authority = args.authority;
        this.subscriptionActivity = args.subscriptionActivity;
    }

    updateAuthority(authority: InoreaderAuthority) {
        this.authority = authority;
    }

    openNewSubscription(subscription: Subscription) {
        const activityItem = new AppSubscriptionActivityItem(subscription.props);
        this.subscriptionActivity = this.subscriptionActivity.addItem(activityItem);
    }

    /**
     * pretend (one) didn't see current focus subscription.
     * This feature remove the subscription from activity
     */
    pretendDidNotOpenCurrentSubscription(): void {
        this.subscriptionActivity = this.subscriptionActivity.removeCurrentItem();
    }
}
