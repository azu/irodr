// MIT © 2017 azu
import * as React from "react";
import { AppPreferencesPanel } from "../../../project/AppPreferencesPanel/AppPreferencesPanel";
import { AppPreferencesState } from "./AppPreferencesStore";
import { BaseContainer } from "../../BaseContainer";
import { DismissAppPreferenceUseCase } from "./use-case/ToggleAppPreferenceUseCase";
import { AppPreferencesJSON } from "../../../../domain/App/Preferences/AppPreferences";
import { createUpdatePreferencesUseCase } from "../../../../use-case/app/UpdatePreferencesUseCase";

export interface AppPreferencesContainerProps {
    appPreferences: AppPreferencesState;
}

export class AppPreferencesContainer extends BaseContainer<AppPreferencesContainerProps, {}> {
    onDismiss = () => {
        return this.useCase(new DismissAppPreferenceUseCase()).execute();
    };

    onSubmit = async (preferencesJSON: AppPreferencesJSON) => {
        try {
            await this.useCase(createUpdatePreferencesUseCase()).execute(preferencesJSON);
        } finally {
            await this.onDismiss();
        }
    };

    render() {
        return (
            <AppPreferencesPanel
                preferences={this.props.appPreferences.asJSON()}
                isOpen={this.props.appPreferences.isPanelOpened}
                onDismiss={this.onDismiss}
                onSubmit={this.onSubmit}
            />
        );
    }
}
