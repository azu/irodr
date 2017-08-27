import * as React from "react";
import { SubscriptionListContainer } from "./SubscriptionList/SubscriptionListContainer";
import { SubscriptionListState } from "./SubscriptionList/SubscriptionListStore";
import { SubscriptionContentsContainer } from "./SubscriptionContents/SubscriptionContentsContainer";
import { SubscriptionContentsState } from "./SubscriptionContents/SubscriptionContentsStore";
import { BaseContainer } from "../../BaseContainer";
import classnames from "classnames";

export interface SubscriptionContainerProps {
    subscriptionContents: SubscriptionContentsState;
    subscriptionList: SubscriptionListState;
}

export class SubscriptionContainer extends BaseContainer<SubscriptionContainerProps, {}> {
    render() {
        return (
            <div className={classnames("SubscriptionContainer", this.props.className)}>
                <SubscriptionListContainer
                    className="SubscriptionContainer-side"
                    subscriptionList={this.props.subscriptionList}
                />
                <SubscriptionContentsContainer
                    className="SubscriptionContainer-main"
                    subscriptionContents={this.props.subscriptionContents}
                />
            </div>
        );
    }
}
