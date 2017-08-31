import * as React from "react";
import "./AppContainer.css";
import { appStoreGroup } from "./AppStoreGroup";
import { BaseContainer } from "../BaseContainer";
import { SubscriptionContainer } from "./Subscription/SubscriptionContainer";
import { AppHeaderContainer } from "./AppHeader/AppHeaderContainer";
import { AppPreferencesContainer } from "./Preferences/AppPreferencesContainer";
import { ShortcutKeyContainer } from "./ShortcutKeyContainer/ShortcutKeyContainer";
import { UserScriptContainer } from "./UserScript/UserScriptContainer";

export class AppContainer extends BaseContainer<typeof appStoreGroup.state, {}> {
    render() {
        return (
            <div className="AppContainer">
                <AppPreferencesContainer appPreferences={this.props.appPreferences} />
                <UserScriptContainer
                    subscriptionList={this.props.subscriptionList}
                    subscriptionContents={this.props.subscriptionContents}
                />
                <ShortcutKeyContainer
                    subscriptionList={this.props.subscriptionList}
                    subscriptionContents={this.props.subscriptionContents}
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
