// MIT © 2017 azu
import ulid from "ulid";
import { AppUser, AppUserIdentifier } from "./AppUser";
import { AppSubscriptionActivity } from "./AppSubscriptionActivity";

export const defaultAppUserArgs = (isMachine: boolean) => {
    return {
        id: new AppUserIdentifier(ulid()),
        isMachine: isMachine,
        subscriptionActivity: new AppSubscriptionActivity({
            items: []
        })
    };
};

export const createMachineUser = () => {
    return new AppUser(defaultAppUserArgs(true));
};

export const createAppUser = () => {
    return new AppUser(defaultAppUserArgs(false));
};
