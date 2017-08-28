// MIT © 2017 azu
import { Store } from "almin";
import { Subscription, SubscriptionIdentifier } from "../../../../../domain/Subscriptions/Subscription";
import { SubscriptionRepository } from "../../../../../infra/repository/SubscriptionRepository";
import { IGroup } from "office-ui-fabric-react";
import { ToggleListGroupUseCasePayload } from "./use-case/ToggleListGroupUseCase";
import { splice } from "@immutable-array/prototype";
import { SubscriptionGroupByCategoryMap } from "../../../../../domain/Subscriptions/InfraSubscription";
import { ShowSubscriptionContentsUseCasePayload } from "../../../../../use-case/subscription/ShowSubscriptionContentsUseCase";

export interface SubscriptionListStateProps {
    currentSubscriptionId?: SubscriptionIdentifier;
    // group for details
    groups: IGroup[];
    groupSubscriptions: Subscription[];
    groupIsCollapsed: {
        [index: string]: boolean;
    };
    // cache
    currentVersion: number;
}

export class SubscriptionListState {
    currentSubscriptionId?: SubscriptionIdentifier;
    groups: IGroup[];
    groupSubscriptions: Subscription[];
    groupIsCollapsed: {
        [index: string]: boolean;
    };
    currentVersion: number;

    constructor(props: SubscriptionListStateProps) {
        this.currentSubscriptionId = props.currentSubscriptionId;
        this.groups = props.groups;
        this.groupSubscriptions = props.groupSubscriptions;
        this.groupIsCollapsed = props.groupIsCollapsed;
        this.currentVersion = props.currentVersion;
    }

    getNextItem(currentSubscription: Subscription): Subscription | undefined {
        const index = this.groupSubscriptions.indexOf(currentSubscription);
        if (index === -1) {
            return;
        }
        return this.groupSubscriptions[index + 1];
    }

    update(categoryMap: SubscriptionGroupByCategoryMap) {
        const currentVersion = categoryMap.version;
        // no change
        if (currentVersion === this.currentVersion) {
            return this;
        }
        // create groups
        let currentIndex = 0;
        let groupSubscriptions: Subscription[] = [];
        const groups: IGroup[] = categoryMap.sortedEntities().map(([categoryName, subscriptions]) => {
            const readableSubscriptions = subscriptions;
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
            currentVersion: currentVersion,
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

    reduce(payload: ToggleListGroupUseCasePayload | ShowSubscriptionContentsUseCasePayload) {
        if (payload instanceof ToggleListGroupUseCasePayload) {
            return new SubscriptionListState({
                ...this as SubscriptionListStateProps,
                groups: this.toggleGroup(payload.categoryKey)
            });
        } else if (payload instanceof ShowSubscriptionContentsUseCasePayload) {
            return new SubscriptionListState({
                ...this as SubscriptionListStateProps,
                currentSubscriptionId: payload.subscriptionId
            });
        } else {
            return this;
        }
    }
}

export class SubscriptionListStore extends Store<SubscriptionListState> {
    state: SubscriptionListState;

    constructor(private repo: { subscriptionRepository: SubscriptionRepository }) {
        super();
        this.state = new SubscriptionListState({
            currentVersion: -1,
            groups: [],
            groupSubscriptions: [],
            groupIsCollapsed: {}
        });
    }

    receivePayload(payload: any) {
        const subscriptionGroupByCategory = this.repo.subscriptionRepository.groupByCategory();
        this.setState(this.state.update(subscriptionGroupByCategory).reduce(payload));
    }

    getState(): SubscriptionListState {
        return this.state;
    }
}
