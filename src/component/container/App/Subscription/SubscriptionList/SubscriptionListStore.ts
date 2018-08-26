// MIT © 2017 azu
import { Store } from "almin";
import { Subscription, SubscriptionIdentifier } from "../../../../../domain/Subscriptions/Subscription";
import { SubscriptionRepository } from "../../../../../infra/repository/SubscriptionRepository";
import { IGroup } from "office-ui-fabric-react";
import { ToggleListGroupUseCasePayload } from "./use-case/ToggleListGroupUseCase";
import { splice } from "@immutable-array/prototype";
import { AppRepository } from "../../../../../infra/repository/AppRepository";
import { AppSubscriptionActivityItem } from "../../../../../domain/App/User/AppSubscriptionActivityItem";
import { AppSubscriptionActivity } from "../../../../../domain/App/User/AppSubscriptionActivity";
import { AppPreferences } from "../../../../../domain/App/Preferences/AppPreferences";
import { ToggleAllListGroupUseCasePayload } from "./use-case/ToggleAllListGroupUseCase";

export interface SubscriptionListStateProps {
    prevSubscriptionId?: SubscriptionIdentifier;
    currentSubscriptionId?: SubscriptionIdentifier;
    // group for details
    groups: IGroup[];
    groupSubscriptions: Subscription[];
    groupIsCollapsed: {
        [index: string]: boolean;
    };
    // preference
    prefetchSubscriptionCount: number;
    // cache
    categoryMap: {
        [index: string]: Subscription[];
    };
}

export class SubscriptionListState {
    prevSubscriptionId?: SubscriptionIdentifier;
    currentSubscriptionId?: SubscriptionIdentifier;
    groups: IGroup[];
    groupSubscriptions: Subscription[];
    groupIsCollapsed: {
        [index: string]: boolean;
    };
    prefetchSubscriptionCount: number;

    categoryMap: {
        [index: string]: Subscription[];
    };

    constructor(props: SubscriptionListStateProps) {
        this.prevSubscriptionId = props.prevSubscriptionId;
        this.currentSubscriptionId = props.currentSubscriptionId;
        this.groups = props.groups;
        this.groupSubscriptions = props.groupSubscriptions;
        this.groupIsCollapsed = props.groupIsCollapsed;
        this.prefetchSubscriptionCount = props.prefetchSubscriptionCount;
        this.categoryMap = props.categoryMap;
    }

    get isMovedFocusedSubscription() {
        if (!this.currentSubscriptionId) {
            return false;
        }
        return !this.currentSubscriptionId.equals(this.prevSubscriptionId);
    }

    getFirstItem(): Subscription | undefined {
        return this.groupSubscriptions[0];
    }

    getItem(currentSubscriptionId: SubscriptionIdentifier): Subscription | undefined {
        return this.groupSubscriptions.find(subscription => subscription.id.equals(currentSubscriptionId));
    }

    getPrevItem(currentSubscriptionId: SubscriptionIdentifier): Subscription | undefined {
        const index = this.groupSubscriptions.findIndex(subscription => subscription.id.equals(currentSubscriptionId));
        if (index === -1) {
            return;
        }
        return this.groupSubscriptions[index - 1];
    }

    getNextItem(currentSubscriptionId: SubscriptionIdentifier): Subscription | undefined {
        const index = this.groupSubscriptions.findIndex(subscription => subscription.id.equals(currentSubscriptionId));
        if (index === -1) {
            return;
        }
        return this.groupSubscriptions[index + 1];
    }

    updateAppPreferences(appPreferences: AppPreferences) {
        if (appPreferences.prefetchSubscriptionCount === this.prefetchSubscriptionCount) {
            return this;
        }
        return new SubscriptionListState({
            ...(this as SubscriptionListStateProps),
            prefetchSubscriptionCount: appPreferences.prefetchSubscriptionCount
        });
    }

    updateCurrentSubscriptionId(
        prevActivityItem: AppSubscriptionActivityItem | undefined,
        currentActivityItem: AppSubscriptionActivityItem | undefined
    ) {
        const prevSubscriptionId = prevActivityItem ? prevActivityItem.id : undefined;
        const currentSubscriptionId = currentActivityItem ? currentActivityItem.id : undefined;
        if (prevSubscriptionId === this.prevSubscriptionId && currentSubscriptionId === this.currentSubscriptionId) {
            return this;
        }
        return new SubscriptionListState({
            ...(this as SubscriptionListStateProps),
            prevSubscriptionId,
            currentSubscriptionId
        });
    }

    updateCategoryMap(categoryMap: { [index: string]: Subscription[] }, subscriptionActivity: AppSubscriptionActivity) {
        // no change
        if (categoryMap === this.categoryMap) {
            return this;
        }
        // create groups
        let currentIndex = 0;
        let groupSubscriptions: Subscription[] = [];
        const categoryNames = Object.keys(categoryMap).sort();
        const groups: IGroup[] = categoryNames.map(categoryName => {
            const subscriptions = categoryMap[categoryName];
            const readableSubscriptions = subscriptions.filter(subscription => {
                if (subscription.hasUnreadContents) {
                    return true;
                }
                // current subscription
                if (subscriptionActivity.isReadRecently(subscription.id)) {
                    return true;
                }
                return false;
            });
            groupSubscriptions = groupSubscriptions.concat(readableSubscriptions);
            if (this.groupIsCollapsed[categoryName] === undefined) {
                this.groupIsCollapsed[categoryName] = false;
            }
            const count = readableSubscriptions.length;
            const group = {
                key: categoryName,
                name: categoryName,
                startIndex: currentIndex,
                count: count,
                isCollapsed: this.groupIsCollapsed[categoryName]
            };
            currentIndex += count;
            return group;
        });
        return new SubscriptionListState({
            ...(this as SubscriptionListStateProps),
            categoryMap,
            groups,
            groupSubscriptions
        });
    }

    private toggleGroup(categoryKey: string): IGroup[] {
        const index = this.groups.findIndex(group => group.key === categoryKey);
        if (index === -1) {
            return this.groups;
        }
        const groupIsCollapsed = this.groupIsCollapsed[categoryKey];
        const targetGroup = this.groups[index];
        const newGroup = this.updateGroupCollapsedStatus(targetGroup, !groupIsCollapsed);
        return splice(this.groups, index, 1, newGroup);
    }

    private updateGroupCollapsedStatus(targetGroup: IGroup, isCollapsed: boolean): IGroup {
        this.groupIsCollapsed[targetGroup.key] = isCollapsed;
        return {
            ...targetGroup,
            isCollapsed: isCollapsed
        };
    }

    private closeGroups() {
        return this.groups.map(group => {
            return this.updateGroupCollapsedStatus(group, false);
        });
    }

    private openGroups() {
        return this.groups.map(group => {
            return this.updateGroupCollapsedStatus(group, true);
        });
    }

    private toggleGroups() {
        const anyOneOpen = this.groups.some(group => group.isCollapsed === true);
        if (anyOneOpen) {
            return this.closeGroups();
        } else {
            return this.openGroups();
        }
    }

    reduce(payload: ToggleListGroupUseCasePayload | ToggleAllListGroupUseCasePayload) {
        if (payload instanceof ToggleListGroupUseCasePayload) {
            return new SubscriptionListState({
                ...(this as SubscriptionListStateProps),
                groups: this.toggleGroup(payload.categoryKey)
            });
        } else if (payload instanceof ToggleAllListGroupUseCasePayload) {
            return new SubscriptionListState({
                ...(this as SubscriptionListStateProps),
                groups: this.toggleGroups()
            });
        } else {
            return this;
        }
    }
}

export class SubscriptionListStore extends Store<SubscriptionListState> {
    state: SubscriptionListState;

    constructor(
        private repo: {
            appRepository: AppRepository;
            subscriptionRepository: SubscriptionRepository;
        }
    ) {
        super();
        const app = this.repo.appRepository.get();
        this.state = new SubscriptionListState({
            prefetchSubscriptionCount: app.preferences.prefetchSubscriptionCount,
            categoryMap: {},
            groups: [],
            groupSubscriptions: [],
            groupIsCollapsed: {}
        });
    }

    receivePayload(payload: any) {
        const app = this.repo.appRepository.get();
        const subscriptionActivity = app.user.subscriptionActivity;
        const subscriptionGroupByCategory = this.repo.subscriptionRepository.groupByCategory();
        this.setState(
            this.state
                .updateCategoryMap(subscriptionGroupByCategory, subscriptionActivity)
                .updateAppPreferences(app.preferences)
                .updateCurrentSubscriptionId(
                    app.user.subscriptionActivity.previousItem,
                    app.user.subscriptionActivity.currentItem
                )
                .reduce(payload)
        );
    }

    getState(): SubscriptionListState {
        return this.state;
    }
}
