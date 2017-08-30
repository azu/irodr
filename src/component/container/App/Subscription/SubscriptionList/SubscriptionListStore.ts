// MIT © 2017 azu
import { Store } from "almin";
import { Subscription, SubscriptionIdentifier } from "../../../../../domain/Subscriptions/Subscription";
import { SubscriptionRepository } from "../../../../../infra/repository/SubscriptionRepository";
import { IGroup } from "office-ui-fabric-react";
import { ToggleListGroupUseCasePayload } from "./use-case/ToggleListGroupUseCase";
import { splice } from "@immutable-array/prototype";
import { AppRepository } from "../../../../../infra/repository/AppRepository";
import { AppSubscriptionActivityItem } from "../../../../../domain/App/User/AppSubscriptionActivityItem";

export interface SubscriptionListStateProps {
    currentSubscriptionId?: SubscriptionIdentifier;
    // group for details
    groups: IGroup[];
    groupSubscriptions: Subscription[];
    groupIsCollapsed: {
        [index: string]: boolean;
    };
    // cache
    categoryMap: {
        [index: string]: Subscription[];
    };
}

export class SubscriptionListState {
    currentSubscriptionId?: SubscriptionIdentifier;
    groups: IGroup[];
    groupSubscriptions: Subscription[];
    groupIsCollapsed: {
        [index: string]: boolean;
    };
    categoryMap: {
        [index: string]: Subscription[];
    };

    constructor(props: SubscriptionListStateProps) {
        this.currentSubscriptionId = props.currentSubscriptionId;
        this.groups = props.groups;
        this.groupSubscriptions = props.groupSubscriptions;
        this.groupIsCollapsed = props.groupIsCollapsed;
        this.categoryMap = props.categoryMap;
    }

    getFirstItem(): Subscription | undefined {
        return this.groupSubscriptions[0];
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

    updateCurrentSubscriptionId(currentActivityItem: AppSubscriptionActivityItem | undefined) {
        const currentSubscriptionId = currentActivityItem ? currentActivityItem.id : undefined;
        return new SubscriptionListState({
            ...this as SubscriptionListStateProps,
            currentSubscriptionId
        });
    }

    updateCategoryMap(categoryMap: { [index: string]: Subscription[] }) {
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
                if (subscription.id.equals(this.currentSubscriptionId)) {
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
            ...this as SubscriptionListStateProps,
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
        const targetGroup = this.groups[index];
        this.groupIsCollapsed[categoryKey] = !this.groupIsCollapsed[categoryKey];
        const newGroup: IGroup = {
            ...targetGroup,
            isCollapsed: this.groupIsCollapsed[categoryKey]
        };
        return splice(this.groups, index, 1, newGroup);
    }

    reduce(payload: ToggleListGroupUseCasePayload) {
        if (payload instanceof ToggleListGroupUseCasePayload) {
            return new SubscriptionListState({
                ...this as SubscriptionListStateProps,
                groups: this.toggleGroup(payload.categoryKey)
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
        this.state = new SubscriptionListState({
            categoryMap: {},
            groups: [],
            groupSubscriptions: [],
            groupIsCollapsed: {}
        });
    }

    receivePayload(payload: any) {
        const app = this.repo.appRepository.get();
        const subscriptionGroupByCategory = this.repo.subscriptionRepository.groupByCategory();
        this.setState(
            this.state
                .updateCategoryMap(subscriptionGroupByCategory)
                .updateCurrentSubscriptionId(app.user.subscriptionActivity.current)
                .reduce(payload)
        );
    }

    getState(): SubscriptionListState {
        return this.state;
    }
}
