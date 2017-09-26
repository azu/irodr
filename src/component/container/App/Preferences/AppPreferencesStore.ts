// MIT © 2017 azu
import { Payload, Store } from "almin";
import { AppPreferences, AppPreferencesJSON } from "../../../../domain/App/Preferences/AppPreferences";
import { AppRepository } from "../../../../infra/repository/AppRepository";
import {
    DismissAppPreferenceUseCasePayload,
    ShowAppPreferenceUseCasePayload
} from "./use-case/ToggleAppPreferenceUseCase";

export interface AppPreferencesProps extends AppPreferencesJSON {
    isPanelOpened: boolean;
}

export class AppPreferencesState {
    isPanelOpened: boolean;
    prefetchSubscriptionCount: number;
    enableAutoRefreshSubscription: boolean;
    autoRefreshSubscriptionSec: number;
    fetchContentsCount: number;

    constructor(props: AppPreferencesProps) {
        this.isPanelOpened = props.isPanelOpened;
        this.prefetchSubscriptionCount = props.prefetchSubscriptionCount;
        this.enableAutoRefreshSubscription = props.enableAutoRefreshSubscription;
        this.autoRefreshSubscriptionSec = props.autoRefreshSubscriptionSec;
        this.fetchContentsCount = props.fetchContentsCount;
    }

    asJSON(): AppPreferencesJSON {
        return {
            prefetchSubscriptionCount: this.prefetchSubscriptionCount,
            enableAutoRefreshSubscription: this.enableAutoRefreshSubscription,
            autoRefreshSubscriptionSec: this.autoRefreshSubscriptionSec,
            fetchContentsCount: this.fetchContentsCount
        };
    }

    update(preferences: AppPreferences) {
        return new AppPreferencesState({
            ...(this as AppPreferencesProps),
            ...preferences
        });
    }

    reduce(payload: ShowAppPreferenceUseCasePayload | DismissAppPreferenceUseCasePayload) {
        if (payload instanceof ShowAppPreferenceUseCasePayload) {
            return new AppPreferencesState({
                ...(this as AppPreferencesProps),
                isPanelOpened: true
            });
        } else if (payload instanceof DismissAppPreferenceUseCasePayload) {
            return new AppPreferencesState({
                ...(this as AppPreferencesProps),
                isPanelOpened: false
            });
        } else {
            return this;
        }
    }
}

export class AppPreferencesStore extends Store<AppPreferencesState> {
    state: AppPreferencesState;

    constructor(private repo: { appRepository: AppRepository }) {
        super();
        const app = repo.appRepository.get();
        this.state = new AppPreferencesState({
            ...app.preferences,
            isPanelOpened: false
        });
    }

    receivePayload(payload: Payload) {
        const app = this.repo.appRepository.get();
        this.setState(this.state.update(app.preferences).reduce(payload));
    }

    getState(): AppPreferencesState {
        return this.state;
    }
}
