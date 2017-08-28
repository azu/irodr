// MIT © 2017 azu
import { App, AppIdentifier } from "./App";
import ulid from "ulid";
import { AppPreferences, DefaultAppPreferences } from "./Preferences/AppPreferences";

export const createApp = () => {
    return new App({
        id: new AppIdentifier(ulid()),
        preferences: new AppPreferences(DefaultAppPreferences)
    });
};
