import * as React from "react";
import "./AppContainer.css";
import { appStoreGroup } from "./AppStoreGroup";
import { BaseContainer } from "../BaseContainer";
import { createUpdateSubscriptionsUseCase } from "../../../use-case/subscription/UpdateSubscriptionsUseCase";
import { SubscriptionContainer } from "./Subscription/SubscriptionContainer";

export class AppContainer extends BaseContainer<typeof appStoreGroup.state, {}> {
    fetchList = () => {
        this.useCase(createUpdateSubscriptionsUseCase()).executor(useCase => useCase.execute());
    };

    render() {
        return (
            <div className="AppContainer">
                <header className="AppContainer-header">
                    <button onClick={this.fetchList}>Fetch</button>
                </header>
                <SubscriptionContainer
                    className="AppContainer-body"
                    subscriptionContents={this.props.subscriptionContents}
                    subscriptionList={this.props.subscriptionList}
                />
            </div>
        );
    }
}
