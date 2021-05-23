// MIT © 2017 azu
import React from "react";
import { Checkbox, Panel, PanelType, PrimaryButton, TextField } from "office-ui-fabric-react";
import { AppPreferencesJSON } from "../../../domain/App/Preferences/AppPreferences";

export interface AppPreferencesPanelProps {
    preferences: AppPreferencesJSON;
    isOpen: boolean;
    // when close panel
    onDismiss: () => void;
    // when submit from panel
    onSubmit: (appPreferencesJSON: AppPreferencesJSON) => void;
}

export interface AppPreferencesPanelState extends AppPreferencesJSON {}

export class AppPreferencesPanel extends React.Component<AppPreferencesPanelProps, AppPreferencesPanelState> {
    onSubmit = () => {
        this.props.onSubmit(this.state);
    };

    updateStateWithSetting = (appPreferences: AppPreferencesJSON) => {
        this.setState(appPreferences);
    };

    componentWillMount() {
        if (this.props.preferences) {
            this.updateStateWithSetting(this.props.preferences);
        }
    }

    componentWillReceiveProps(nextProps: AppPreferencesPanelProps) {
        if (nextProps.preferences) {
            this.updateStateWithSetting(nextProps.preferences);
        }
    }

    render() {
        return (
            <Panel
                className="AppPreferencesPanel"
                isOpen={this.props.isOpen}
                type={PanelType.medium}
                isLightDismiss={true}
                headerText={"App Preference"}
                onDismiss={() => this.props.onDismiss()}
            >
                <Checkbox
                    label="Enable Auto Refresh Subscription"
                    checked={this.state.enableAutoRefreshSubscription}
                    onChange={(ev, checked) => {
                        this.setState({
                            enableAutoRefreshSubscription: !!checked
                        });
                    }}
                />
                <TextField
                    className="AppPreferencesPanel-autoRefreshSubscriptionSec"
                    label="Auto Refresh Subscription Seconds"
                    value={String(this.state.autoRefreshSubscriptionSec)}
                    onChanged={(newValue) => {
                        const autoRefreshSubscriptionSec = Number(newValue);
                        if (Number.isNaN(autoRefreshSubscriptionSec)) {
                            return;
                        }
                        this.setState({
                            autoRefreshSubscriptionSec
                        });
                    }}
                />
                <TextField
                    className="AppPreferencesPanel-prefetchSubscriptionCount"
                    label="Prefetch Subscription Count"
                    value={String(this.state.prefetchSubscriptionCount)}
                    onChanged={(newValue) => {
                        const prefetchSubscriptionCount = Number(newValue);
                        if (Number.isNaN(prefetchSubscriptionCount)) {
                            return;
                        }
                        this.setState({
                            prefetchSubscriptionCount: prefetchSubscriptionCount
                        });
                    }}
                />

                <TextField
                    className="AppPreferencesPanel-fetchContentsCount"
                    label="Fetch subscription contents Count"
                    value={String(this.state.fetchContentsCount)}
                    onChanged={(newValue) => {
                        const fetchContentsCount = Number(newValue);
                        if (Number.isNaN(fetchContentsCount)) {
                            return;
                        }
                        this.setState({
                            fetchContentsCount: fetchContentsCount
                        });
                    }}
                />
                <div className="GitHubSettingPanel-footer">
                    <PrimaryButton
                        onClick={this.onSubmit}
                        data-automation-id="save-setting"
                        ariaDescription="Save preference"
                    >
                        Save
                    </PrimaryButton>
                </div>
            </Panel>
        );
    }
}
