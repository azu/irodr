// MIT © 2017 azu
import * as React from "react";
import { createUpdateSubscriptionsUseCase } from "../../../../use-case/subscription/UpdateSubscriptionsUseCase";
import { BaseContainer } from "../../BaseContainer";
import { AppHeaderState } from "./AppHeaderStore";
import classnames from "classnames";
import { IconButton, Image, ImageFit, Link } from "office-ui-fabric-react";
import { ShowAppPreferenceUseCase } from "../Preferences/use-case/ToggleAppPreferenceUseCase";

const GitHubIcon = require("react-icons/lib/ti/social-github");

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
                    <h1 className="AppHeaderContainer-title" title="Irodr">
                        <Image
                            className="AppHeaderContainer-favicon"
                            src={`${process.env.PUBLIC_URL}/favicon.png`}
                            width={20}
                            height={20}
                            imageFit={ImageFit.cover}
                        />rodr
                    </h1>
                    <div className="AppHeaderContainer-menu">
                        <IconButton
                            className="AppHeaderContainer-reloadButton"
                            iconProps={{ iconName: "Refresh" }}
                            title="Reload subscriptions"
                            onClick={this.fetchList}
                        />
                    </div>
                </div>
                <div className="AppHeaderContainer-center">
                    <span className="AppHeaderContainer-message">{this.props.appHeader.message}</span>
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
                    <Link title="Irodr on GitHub" href="https://github.com/azu/irodr">
                        <GitHubIcon size="24" />
                    </Link>
                </div>
            </header>
        );
    }
}
