// MIT © 2017 azu
import { App, AppIdentifier } from "./App";
import ulid from "ulid";
import { AppPreferences, DefaultAppPreferences } from "./Preferences/AppPreferences";
import { createAppUser } from "./User/AppUserFactory";

export const createApp = () => {
    return new App({
        id: new AppIdentifier(ulid()),
        user: createAppUser(),
        preferences: new AppPreferences(DefaultAppPreferences)
    });
};
