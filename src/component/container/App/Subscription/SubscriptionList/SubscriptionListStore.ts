// MIT © 2017 azu
import { Store } from "almin";
import { Subscription } from "../../../../../domain/Subscriptions/Subscription";
import { SubscriptionRepository } from "../../../../../infra/repository/SubscriptionRepository";

export interface SubscriptionListStateProps {
    displaySubscriptions: Subscription[];
}

export class SubscriptionListState {
    displaySubscriptions: Subscription[];

    constructor(props: SubscriptionListStateProps) {
        this.displaySubscriptions = props.displaySubscriptions;
    }

    update(subscriptions: Subscription[]) {
        return new SubscriptionListState({
            displaySubscriptions: subscriptions.filter(subscription => {
                return subscription.hasUnreadContents;
            })
        });
    }
}

export class SubscriptionListStore extends Store<SubscriptionListState> {
    state: SubscriptionListState;

    constructor(private repo: { subscriptionRepository: SubscriptionRepository }) {
        super();
        this.state = new SubscriptionListState({
            displaySubscriptions: []
        });
    }

    receivePayload() {
        const subscriptions = this.repo.subscriptionRepository.getAll();
        this.setState(this.state.update(subscriptions));
    }

    getState(): SubscriptionListState {
        return this.state;
    }
}
