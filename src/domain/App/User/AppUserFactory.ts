// MIT © 2017 azu
import { AppUser, AppUserIdentifier } from "./AppUser";
import ulid from "ulid";
import { AppSubscriptionActivity } from "./AppSubscriptionActivity";

export const createAppUser = () => {
    return new AppUser({
        id: new AppUserIdentifier(ulid()),
        subscriptionActivity: new AppSubscriptionActivity({
            items: []
        })
    });
};
