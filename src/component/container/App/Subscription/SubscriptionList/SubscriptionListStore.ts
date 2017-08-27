// MIT © 2017 azu
import { Store } from "almin";
import { Subscription } from "../../../../../domain/Subscriptions/Subscription";
import { SubscriptionRepository } from "../../../../../infra/repository/SubscriptionRepository";
import { IGroup } from "office-ui-fabric-react";
import { ToggleListGroupUseCasePayload } from "./use-case/ToggleListGroupUseCase";
import { splice } from "@immutable-array/prototype";

export interface SubscriptionListStateProps {
    currentSubscription?: Subscription;
    subscriptions: Subscription[];
    // displayed itemds
    displaySubscriptions: Subscription[];
    // group for details
    groups: IGroup[];
    groupSubscriptions: Subscription[];
    groupIsCollapsed: {
        [index: string]: boolean;
    };
}

export class SubscriptionListState {
    currentSubscription?: Subscription;
    subscriptions: Subscription[];
    displaySubscriptions: Subscription[];
    groups: IGroup[];
    groupSubscriptions: Subscription[];
    groupIsCollapsed: {
        [index: string]: boolean;
    };

    constructor(props: SubscriptionListStateProps) {
        this.currentSubscription = props.currentSubscription;
        this.subscriptions = props.subscriptions;
        this.displaySubscriptions = props.displaySubscriptions;
        this.groups = props.groups;
        this.groupSubscriptions = props.groupSubscriptions;
        this.groupIsCollapsed = props.groupIsCollapsed;
    }

    update(subscriptions: Subscription[]) {
        if (this.subscriptions === subscriptions) {
            return this;
        }

        const displaySubscriptions = subscriptions.filter(subscription => subscription.hasUnreadContents);
        const categories: { [index: string]: Subscription[] } = {};
        displaySubscriptions.forEach(subscription => {
            subscription.categories.forEach(category => {
                if (Array.isArray(categories[category])) {
                    categories[category].push(subscription);
                } else {
                    categories[category] = [subscription];
                }
            });
        });

        // create groups
        let currentIndex = 0;
        let groupSubscriptions: Subscription[] = [];
        const groups = Object.keys(categories).sort().map(category => {
            const subscriptions = categories[category];
            groupSubscriptions = groupSubscriptions.concat(subscriptions);
            if (this.groupIsCollapsed[category] === undefined) {
                this.groupIsCollapsed[category] = false;
            }
            const group = {
                key: category,
                name: category,
                startIndex: currentIndex,
                count: subscriptions.length,
                isCollapsed: this.groupIsCollapsed[category]
            };
            currentIndex += subscriptions.length;
            return group;
        });
        return new SubscriptionListState({
            ...this as SubscriptionListStateProps,
            subscriptions,
            displaySubscriptions,
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
            subscriptions: [],
            displaySubscriptions: [],
            groups: [],
            groupSubscriptions: [],
            groupIsCollapsed: {}
        });
    }

    receivePayload(payload: any) {
        const subscriptions = this.repo.subscriptionRepository.getAll();
        this.setState(this.state.update(subscriptions).reduce(payload));
    }

    getState(): SubscriptionListState {
        return this.state;
    }
}
