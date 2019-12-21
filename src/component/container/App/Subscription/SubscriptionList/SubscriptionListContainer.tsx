// MIT © 2017 azu
import * as React from "react";
import { SubscriptionListState } from "./SubscriptionListStore";
import { GroupedList, IGroupDividerProps, Link } from "office-ui-fabric-react";
import { Subscription, SubscriptionIdentifier } from "../../../../../domain/Subscriptions/Subscription";
import { BaseContainer } from "../../../BaseContainer";

import classnames from "classnames";
import { createShowSubscriptionContentsUseCase } from "../../../../../use-case/subscription/ShowSubscriptionContentsUseCase";
import { createToggleListGroupUseCase } from "./use-case/ToggleListGroupUseCase";
import { createPrefetchSubscriptContentsUseCase } from "../../../../../use-case/subscription/PrefetchSubscriptContentsUseCase";
import { createMarkAsReadToClientUseCase } from "../../../../../use-case/subscription/MarkAsReadToClientUseCase";
import { createMarkAsReadToServerUseCase } from "../../../../../use-case/subscription/MarkAsReadToServerUseCase";
import { createUpdateHeaderMessageUseCase } from "../../../../../use-case/app/UpdateHeaderMessageUseCase";
import { debounce } from "lodash";

function scrollToSubscriptionId(subscriptionId: SubscriptionIdentifier) {
    const targetElement = document.querySelector(
        `.SubscriptionListContainer-item[data-feedid="${subscriptionId.toValue()}"]`
    );
    if (targetElement) {
        targetElement.scrollIntoView();
    }
}

const debounceScrollToSubscriptionId = debounce(scrollToSubscriptionId, 16);

export interface SubscriptionListContainerProps {
    subscriptionList: SubscriptionListState;
}

export class SubscriptionListContainer extends BaseContainer<SubscriptionListContainerProps, {}> {
    private groupList: React.Ref<GroupedList> = React.createRef();
    private onClickSubscription = async (item: Subscription) => {
        await this.useCase(createShowSubscriptionContentsUseCase()).execute(item.id);
    };
    private prefetchSubscriptions = async (
        currentSubscriptionId: SubscriptionIdentifier,
        count: number
    ): Promise<void> => {
        if (count <= 0) {
            return;
        }
        const nextItem = this.props.subscriptionList.getNextItem(currentSubscriptionId);
        if (!nextItem) {
            return;
        }
        await this.useCase(createPrefetchSubscriptContentsUseCase()).execute(nextItem.id);
        return this.prefetchSubscriptions(nextItem.id, count - 1);
    };

    async componentDidUpdate(prevProp: SubscriptionListContainerProps) {
        const visiblePrevSubscriptionId = prevProp.subscriptionList.currentSubscriptionId;
        const currentSubscriptionId = this.props.subscriptionList.currentSubscriptionId;
        const isChangedVisibleCurrentSubscriptionId = visiblePrevSubscriptionId !== currentSubscriptionId;
        // Prevent infinite loop for updating component
        if (!currentSubscriptionId) {
            return;
        }
        if (!isChangedVisibleCurrentSubscriptionId) {
            return;
        }
        // If visible is changed ===> Try to update domain model ===>
        // visible prev is not activity prev
        // We should mark activity id as read
        const prevSubscriptionId = this.props.subscriptionList.prevSubscriptionId;
        if (prevSubscriptionId) {
            await this.useCase(createMarkAsReadToClientUseCase()).execute(prevSubscriptionId);
        }
        debounceScrollToSubscriptionId(currentSubscriptionId);
        // prefetch next items
        await this.prefetchSubscriptions(currentSubscriptionId, this.props.subscriptionList.prefetchSubscriptionCount);
        await this.useCase(createUpdateHeaderMessageUseCase()).execute(
            `Complete prefetch ${this.props.subscriptionList.prefetchSubscriptionCount} items`
        );
        // complete
        if (prevSubscriptionId) {
            await this.useCase(createMarkAsReadToServerUseCase()).execute(prevSubscriptionId);
        }
    }

    render() {
        // TODO: empty group should shown as empty group.
        // Current, empty element
        return (
            <div className={classnames("SubscriptionListContainer", this.props.className)}>
                <GroupedList
                    ref={this.groupList}
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

    private _onRenderCell = (nestingDepth?: number, subscription?: Subscription, itemIndex?: number) => {
        if (!subscription) {
            return null;
        }
        const onClick = () => {
            this.onClickSubscription(subscription);
        };
        const isCurrentItem = subscription.id.equals(this.props.subscriptionList.currentSubscriptionId);
        return (
            <div
                data-selection-index={itemIndex}
                className={classnames("SubscriptionListContainer-item", {
                    "is-currentItem": isCurrentItem,
                    "has-unreadContents": subscription.hasBeenUnreadAndHasContents,
                    "has-read": subscription.hasBeenRead
                })}
                onClick={onClick}
                data-feedid={subscription.id.toValue()}
            >
                <img
                    className="SubscriptionListContainer-itemImage"
                    src={subscription.iconUrl}
                    width={16}
                    height={16}
                />
                <Link className="SubscriptionListContainer-itemLink">
                    {subscription.title.length > 40 ? subscription.title.slice(0, 40) + "…" : subscription.title} (
                    {subscription.unread.count})
                </Link>
            </div>
        );
    };

    private _onRenderHeader = (props?: IGroupDividerProps) => {
        if (props === undefined) {
            return null;
        }

        const icon = props.group!.isCollapsed ? (
            <i className="ms-Icon ms-Icon--ExploreContentSingle" aria-hidden="true" />
        ) : (
            <i className="ms-Icon ms-Icon--CollapseContentSingle" aria-hidden="true" />
        );
        const onClickGroupListLink = () => {
            this.useCase(createToggleListGroupUseCase()).execute(props.group!.key);
        };
        return (
            <div className="SubscriptionListContainer-listHeader">
                <Link className="SubscriptionListContainer-listHeaderButton" onClick={onClickGroupListLink}>
                    {icon} {props.group!.name}
                </Link>
            </div>
        );
    };
}
