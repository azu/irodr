// MIT © 2017 azu
import * as React from "react";
import { createUpdateSubscriptionsUseCase } from "../../../../use-case/subscription/UpdateSubscriptionsUseCase";
import { BaseContainer } from "../../BaseContainer";
import { AppHeaderState } from "./AppHeaderStore";
import classnames from "classnames";
import { CommandBar, IconButton, Image, ImageFit, Link } from "office-ui-fabric-react";
import { ShowAppPreferenceUseCase } from "../Preferences/use-case/ToggleAppPreferenceUseCase";
import { createGoToOAuthPageUseCase } from "../../../../use-case/app/GoToOAuthPageUseCase";

const GitHubIcon = require("react-icons/lib/ti/social-github");

export interface AppHeaderContainerProps {
    appHeader: AppHeaderState;
}

export class AppHeaderContainer extends BaseContainer<AppHeaderContainerProps, {}> {
    private fetchList = () => {
        this.useCase(createUpdateSubscriptionsUseCase()).executor(useCase => useCase.execute());
    };

    private onClickPreferences = () => {
        this.useCase(new ShowAppPreferenceUseCase()).executor(useCase => useCase.execute());
    };
    private authorizeAPI = () => {
        this.useCase(createGoToOAuthPageUseCase()).executor(useCase => useCase.execute());
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
                        <CommandBar
                            isSearchBoxVisible={false}
                            items={[
                                {
                                    key: "reload-list",
                                    name: "Refresh",
                                    icon: "Refresh",
                                    ariaLabel: "Refresh Subscription list",
                                    onClick: this.fetchList
                                },
                                {
                                    key: "inoreader",
                                    name: "Inoreader",
                                    icon: "Cloud",
                                    ariaLabel: "Inoreader menu",
                                    subMenuProps: {
                                        items: [
                                            {
                                                key: "inoreader.site",
                                                name: "Open Inoreader",
                                                icon: "World",
                                                onClick: () => {
                                                    window.open("https://www.inoreader.com", "_blank");
                                                }
                                            },
                                            {
                                                key: "inoreader.auth",
                                                name: "Authorize",
                                                icon: "Rocket",
                                                onClick: this.authorizeAPI
                                            }
                                        ]
                                    }
                                }
                            ]}
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
