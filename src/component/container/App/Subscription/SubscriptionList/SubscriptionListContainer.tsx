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
import debounce from "lodash.debounce";

function scrollToSubscriptionId(subscriptionId: SubscriptionIdentifier, block: ScrollLogicalPosition = "start") {
    const targetElement = document.querySelector(
        `.SubscriptionListContainer-item[data-feedid="${subscriptionId.toValue()}"]`
    );
    if (targetElement) {
        targetElement.scrollIntoView({ block });
    }
}

const debounceScrollToSubscriptionId = debounce(scrollToSubscriptionId, 16);

export interface SubscriptionListContainerProps {
    subscriptionList: SubscriptionListState;
}

export class SubscriptionListContainer extends BaseContainer<SubscriptionListContainerProps, {}> {
    private onClickSubscription = async (item: Subscription) => {
        await this.useCase(createShowSubscriptionContentsUseCase()).execute(item.props.id);
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
        await this.useCase(createPrefetchSubscriptContentsUseCase()).execute(nextItem.props.id);
        return this.prefetchSubscriptions(nextItem.props.id, count - 1);
    };

    async componentDidUpdate(prevProp: SubscriptionListContainerProps) {
        const visiblePrevSubscriptionId = prevProp.subscriptionList.currentSubscriptionId;
        const currentSubscriptionId = this.props.subscriptionList.currentSubscriptionId;
        const isChangedVisibleCurrentSubscriptionId = !currentSubscriptionId?.equals(visiblePrevSubscriptionId);
        // Prevent infinite loop for updating component
        if (!currentSubscriptionId) {
            return;
        }
        if (!isChangedVisibleCurrentSubscriptionId) {
            // Marking a GitHub feed read removes it from the list. The rows above the
            // current feed shift up without moving scrollTop, hiding the current feed.
            // Re-align it instead of re-running the navigation side effects.
            const prevIndex = prevProp.subscriptionList.groupSubscriptions.findIndex((subscription) =>
                subscription.props.id.equals(currentSubscriptionId)
            );
            const currentIndex = this.props.subscriptionList.groupSubscriptions.findIndex((subscription) =>
                subscription.props.id.equals(currentSubscriptionId)
            );
            if (currentIndex !== -1 && prevIndex !== -1 && prevIndex !== currentIndex) {
                debounceScrollToSubscriptionId(currentSubscriptionId, "nearest");
            }
            return;
        }
        const prevSubscriptionId = this.props.subscriptionList.prevSubscriptionId;
        // Skip navigation removes the visible feed from activity. Never mark an
        // unrelated history entry read in its place.
        const previous =
            visiblePrevSubscriptionId && prevSubscriptionId?.equals(visiblePrevSubscriptionId)
                ? prevProp.subscriptionList.getItem(visiblePrevSubscriptionId)
                : undefined;
        // Freeze the loaded GitHub items at departure; a later sync must not add
        // newly arrived, unseen notifications to this automatic read operation.
        const loadedItemIds = previous?.props.sourceId
            ? previous.contents
                  .getContentList()
                  .map((item) => item.canonicalItemId)
                  .filter((id): id is string => id !== undefined)
            : undefined;
        const readThrough =
            previous?.props.sourceId && previous.contents.hasContent
                ? new Date(
                      previous.contents
                          .getContentList()
                          .reduce((latest, item) => Math.max(latest, item.updatedDate.millSecond), 0)
                  ).toISOString()
                : undefined;
        if (previous && !previous.props.sourceId) {
            await this.useCase(createMarkAsReadToClientUseCase()).execute(previous.props.id);
        }
        debounceScrollToSubscriptionId(currentSubscriptionId);
        try {
            await this.prefetchSubscriptions(
                currentSubscriptionId,
                this.props.subscriptionList.prefetchSubscriptionCount
            );
            await this.useCase(createUpdateHeaderMessageUseCase()).execute(
                `Complete prefetch ${this.props.subscriptionList.prefetchSubscriptionCount} items`
            );
        } catch {
            await this.useCase(createUpdateHeaderMessageUseCase()).execute("Could not prefetch the next feeds.");
        } finally {
            if (previous) {
                await this.useCase(createMarkAsReadToServerUseCase()).execute(
                    previous.props.id,
                    loadedItemIds,
                    readThrough
                );
            }
        }
    }

    render() {
        // TODO: empty group should shown as empty group.
        // Current, empty element
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

    private _onRenderCell = (nestingDepth?: number, subscription?: Subscription, itemIndex?: number) => {
        if (!subscription) {
            return null;
        }
        const onClick = () => {
            this.onClickSubscription(subscription);
        };
        const isCurrentItem = subscription.props.id.equals(this.props.subscriptionList.currentSubscriptionId);
        return (
            <div
                data-selection-index={itemIndex}
                className={classnames("SubscriptionListContainer-item", {
                    "is-currentItem": isCurrentItem,
                    "has-unreadContents": subscription.hasBeenUnreadAndHasContents,
                    "has-read": subscription.hasBeenRead
                })}
                onClick={onClick}
                data-feedid={subscription.props.id.toValue()}
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
