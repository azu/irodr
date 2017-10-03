import * as React from "react";
import "./AppContainer.css";
import { appStoreGroup } from "./AppStoreGroup";
import { BaseContainer } from "../BaseContainer";
import { SubscriptionContainer } from "./Subscription/SubscriptionContainer";
import { AppHeaderContainer } from "./AppHeader/AppHeaderContainer";
import { AppPreferencesContainer } from "./Preferences/AppPreferencesContainer";
import { HiddenContainer } from "./Hidden/HiddenContainer";
import { AuthorizePanelContainer } from "./Panel/AuthorizePanelContainer";

export class AppContainer extends BaseContainer<typeof appStoreGroup.state, {}> {
    render() {
        return (
            <div className="AppContainer">
                <AppPreferencesContainer appPreferences={this.props.appPreferences} />
                <AuthorizePanelContainer authorizePanel={this.props.authorizePanel} />
                <HiddenContainer
                    appPreferences={this.props.appPreferences}
                    subscriptionContents={this.props.subscriptionContents}
                    subscriptionList={this.props.subscriptionList}
                />
                <AppHeaderContainer className="AppContainer-header" appHeader={this.props.appHeader} />
                <SubscriptionContainer
                    className="AppContainer-body"
                    subscriptionContents={this.props.subscriptionContents}
                    subscriptionList={this.props.subscriptionList}
                />
            </div>
        );
    }
}
