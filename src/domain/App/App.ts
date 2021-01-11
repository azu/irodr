// MIT © 2017 azu
import { Entity, Identifier, Serializer } from "ddd-base";
import { AppPreferences, AppPreferencesJSON, AppPreferencesSerializer } from "./Preferences/AppPreferences";
import { AppUser, AppUserJSON, AppUserSerializer } from "./User/AppUser";

export const AppSerializer: Serializer<App, AppJSON> = {
    toJSON(entity) {
        return {
            id: entity.id.toValue(),
            user: AppUserSerializer.toJSON(entity.user),
            preferences: AppPreferencesSerializer.toJSON(entity.preferences)
        };
    },
    fromJSON(json) {
        return new App({
            id: new AppIdentifier(json.id),
            user: AppUserSerializer.fromJSON(json.user),
            preferences: AppPreferencesSerializer.fromJSON(json.preferences)
        });
    }
};

export interface AppJSON {
    id: string;
    user: AppUserJSON;
    preferences: AppPreferencesJSON;
}

export interface AppArgs {
    id: AppIdentifier;
    user: AppUser;
    preferences: AppPreferences;
}

export class AppIdentifier extends Identifier<string> {}

export class App extends Entity<AppArgs> {
    id: AppIdentifier;
    user: AppUser;
    preferences: AppPreferences;

    constructor(args: AppArgs) {
        super(args);
        this.id = args.id;
        this.user = args.user;
        this.preferences = args.preferences;
    }

    updateUser(user: AppUser) {
        return new App({
            ...(this as AppArgs),
            user
        });
    }

    updatePreferences(preferences: Partial<AppPreferences>): App {
        return new App({
            ...(this as AppArgs),
            preferences: this.preferences.update(preferences)
        });
    }
}
