// MIT © 2017 azu
import { Store } from "almin";
import { Subscription } from "../../../../../domain/Subscriptions/Subscription";
import { SubscriptionRepository } from "../../../../../infra/repository/SubscriptionRepository";
import { IGroup } from "office-ui-fabric-react";
import { ToggleListGroupUseCasePayload } from "./use-case/ToggleListGroupUseCase";
import { splice } from "@immutable-array/prototype";
import { SubscriptionGroupByCategoryMap } from "../../../../../domain/Subscriptions/InfraSubscription";

export interface SubscriptionListStateProps {
    currentSubscription?: Subscription;
    // group for details
    groups: IGroup[];
    groupSubscriptions: Subscription[];
    groupIsCollapsed: {
        [index: string]: boolean;
    };
}

export class SubscriptionListState {
    currentSubscription?: Subscription;
    groups: IGroup[];
    groupSubscriptions: Subscription[];
    groupIsCollapsed: {
        [index: string]: boolean;
    };

    constructor(props: SubscriptionListStateProps) {
        this.currentSubscription = props.currentSubscription;
        this.groups = props.groups;
        this.groupSubscriptions = props.groupSubscriptions;
        this.groupIsCollapsed = props.groupIsCollapsed;
    }

    update(categoryMap: SubscriptionGroupByCategoryMap) {
        // create groups
        let currentIndex = 0;
        let groupSubscriptions: Subscription[] = [];
        const groups: IGroup[] = categoryMap.entries().map(([categoryName, subscriptions]) => {
            const readableSubsctriptions = subscriptions.filter(subscription => subscription.hasUnreadContents);
            groupSubscriptions = groupSubscriptions.concat(readableSubsctriptions);
            if (this.groupIsCollapsed[categoryName] === undefined) {
                this.groupIsCollapsed[categoryName] = false;
            }
            const group = {
                key: categoryName,
                name: categoryName,
                startIndex: currentIndex,
                count: readableSubsctriptions.length,
                isCollapsed: this.groupIsCollapsed[categoryName]
            };
            currentIndex += readableSubsctriptions.length;
            return group;
        });
        return new SubscriptionListState({
            ...this as SubscriptionListStateProps,
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

    constructor(private repo: { subscriptionRepository: SubscriptionRepository }) {
        super();
        this.state = new SubscriptionListState({
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
