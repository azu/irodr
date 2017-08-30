// MIT © 2017 azu
import * as React from "react";
import { createUpdateSubscriptionsUseCase } from "../../../../use-case/subscription/UpdateSubscriptionsUseCase";
import { BaseContainer } from "../../BaseContainer";
import { AppHeaderState } from "./AppHeaderStore";
import classnames from "classnames";
import { IconButton } from "office-ui-fabric-react";
import { ShowAppPreferenceUseCase } from "../Preferences/use-case/ToggleAppPreferenceUseCase";

export interface AppHeaderContainerProps {
    appHeader: AppHeaderState;
}

export class AppHeaderContainer extends BaseContainer<AppHeaderContainerProps, {}> {
    fetchList = () => {
        this.useCase(createUpdateSubscriptionsUseCase()).executor(useCase => useCase.execute());
    };

    onClickPreferences = () => {
        this.useCase(new ShowAppPreferenceUseCase()).executor(useCase => useCase.execute());
    };

    render() {
        return (
            <header className={classnames("AppHeaderContainer", this.props.className)}>
                <div className="AppHeaderContainer-left">
                    <h1 className="AppHeaderContainer-title">Irodr</h1>
                    <div className="AppHeaderContainer-menu">
                        <IconButton
                            className="AppHeaderContainer-reloadButton"
                            iconProps={{ iconName: "Refresh" }}
                            title="Reload subscriptions"
                            onClick={this.fetchList}
                        />
                    </div>
                </div>
                <div className="AppHeaderContainer-right">
                    <span className="AppHeaderContainer-totalUnreadCount">
                        Unread: {this.props.appHeader.totalUnread}
                    </span>
                    <span className="AppHeaderContainer-totalSubscriptionCount">
                        Subscriptions: {this.props.appHeader.totalSubscriptionCount}
                    </span>
                    <IconButton
                        className="AppHeaderContainer-preferencesButton"
                        iconProps={{ iconName: "Settings" }}
                        title="Setting"
                        onClick={this.onClickPreferences}
                    />
                </div>
            </header>
        );
    }
}
