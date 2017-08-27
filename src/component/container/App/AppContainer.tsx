import * as React from "react";
import "./AppContainer.css";
import { appStoreGroup } from "./AppStoreGroup";
import { BaseContainer } from "../BaseContainer";
import { SubscriptionContainer } from "./Subscription/SubscriptionContainer";
import { AppHeaderContainer } from "./AppHeader/AppHeaderContainer";

export class AppContainer extends BaseContainer<typeof appStoreGroup.state, {}> {
    render() {
        return (
            <div className="AppContainer">
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
