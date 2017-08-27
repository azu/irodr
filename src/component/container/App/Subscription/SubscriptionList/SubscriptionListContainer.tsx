// MIT © 2017 azu
import * as React from "react";
import { SubscriptionListState } from "./SubscriptionListStore";
import { GroupedList, IGroupDividerProps, Image, ImageFit, Link } from "office-ui-fabric-react";
import { Subscription } from "../../../../../domain/Subscriptions/Subscription";
import { BaseContainer } from "../../../BaseContainer";

import classnames from "classnames";
import { createShowSubscriptionContentsUseCase } from "../../../../../use-case/subscription/ShowSubscriptionContentsUseCase";
import { createToggleListGroupUseCase } from "./use-case/ToggleListGroupUseCase";
import { createPrefetchSubscriptContentsUseCase } from "../../../../../use-case/subscription/PrefetchSubscriptContentsUseCase";

export interface SubscriptionListContainerProps {
    subscriptionList: SubscriptionListState;
}

export class SubscriptionListContainer extends BaseContainer<SubscriptionListContainerProps, {}> {
    private onClickSubscription = async (item: Subscription) => {
        await this.useCase(createShowSubscriptionContentsUseCase()).executor(useCase => useCase.execute(item.id));
        // prefetch 3 items
        return this.fetchSubscriptions(item, 3);
    };

    private fetchSubscriptions = async (currentSubscription: Subscription, count: number): Promise<void> => {
        if (count <= 0) {
            return;
        }
        const nextItem = this.props.subscriptionList.getNextItem(currentSubscription);
        if (!nextItem) {
            return;
        }
        await this.useCase(createPrefetchSubscriptContentsUseCase()).executor(useCase => useCase.execute(nextItem.id));
        return this.fetchSubscriptions(nextItem, count - 1);
    };

    render() {
        return (
            <div className={classnames("SubscriptionListContainer", this.props.className)}>
                <GroupedList
                    items={this.props.subscriptionList.groupSubscriptions}
                    onRenderCell={this._onRenderCell}
                    groupProps={{
                        onRenderHeader: this._onRenderHeader
                    }}
                    groups={this.props.subscriptionList.groups}
                />
            </div>
        );
    }

    private _onRenderCell = (nestingDepth: number, item: Subscription, itemIndex: number) => {
        const onClick = () => {
            this.onClickSubscription(item);
        };
        const isCurrentItem = item.id.equals(this.props.subscriptionList.currentSubscriptionId);
        return (
            <div
                data-selection-index={itemIndex}
                className={classnames("SubscriptionListContainer-item", {
                    "is-currentItem": isCurrentItem
                })}
            >
                <Image
                    className="SubscriptionListContainer-itemImage"
                    src={item.iconUrl}
                    width={16}
                    height={16}
                    imageFit={ImageFit.cover}
                />
                <Link className="SubscriptionListContainer-itemLink" onClick={onClick}>
                    {item.title} ({item.unread.count})
                </Link>
            </div>
        );
    };

    private _onRenderHeader = (props: IGroupDividerProps) => {
        if (props === undefined) {
            return null;
        }

        const icon = props.group!.isCollapsed ? (
            <i className="ms-Icon ms-Icon--ExploreContentSingle" aria-hidden="true" />
        ) : (
            <i className="ms-Icon ms-Icon--CollapseContentSingle" aria-hidden="true" />
        );
        return (
            <div className="SubscriptionListContainer-listHeader">
                <Link
                    className="SubscriptionListContainer-listHeaderButton"
                    onClick={() => {
                        this.useCase(createToggleListGroupUseCase()).executor(useCase =>
                            useCase.execute(props.group!.key)
                        );
                    }}
                >
                    {icon} {props.group!.name}
                </Link>
            </div>
        );
    };
}
