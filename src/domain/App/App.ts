// MIT © 2017 azu
import { Entity, Identifier, Serializer } from "ddd-base";
import { AppPreferences, AppPreferencesJSON, AppPreferencesSerializer } from "./Preferences/AppPreferences";

export interface AppArgs {
    id: AppIdentifier;
    preferences: AppPreferences;
}

export const AppSerializer: Serializer<App, AppJSON> = {
    toJSON(entity) {
        return {
            id: entity.id.toValue(),
            preferences: AppPreferencesSerializer.toJSON(entity.preferences)
        };
    },
    fromJSON(json) {
        return new App({
            id: new AppIdentifier(json.id),
            preferences: AppPreferencesSerializer.fromJSON(json.preferences)
        });
    }
};

export interface AppJSON {
    id: string;
    preferences: AppPreferencesJSON;
}

export class AppIdentifier extends Identifier<string> {}

export class App extends Entity<AppIdentifier> {
    id: AppIdentifier;
    preferences: AppPreferences;

    constructor(args: AppArgs) {
        super(args.id);
        this.preferences = args.preferences;
    }

    updatePreferences(preferences: Partial<AppPreferences>): App {
        return new App({
            ...this as AppArgs,
            preferences: this.preferences.update(preferences)
        });
    }
}
