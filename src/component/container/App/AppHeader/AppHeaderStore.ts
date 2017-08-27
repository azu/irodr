// MIT © 2017 azu
import { Store } from "almin";
import { SubscriptionRepository } from "../../../../infra/repository/SubscriptionRepository";
import { Subscription } from "../../../../domain/Subscriptions/Subscription";

export interface AppHeaderStateProps {
    totalUnread: number;
    totalSubscriptionCount: number;
}

export class AppHeaderState {
    totalUnread: number;
    totalSubscriptionCount: number;

    constructor(props: AppHeaderStateProps) {
        this.totalUnread = props.totalUnread;
        this.totalSubscriptionCount = props.totalSubscriptionCount;
    }

    private computeTotalUnread(subscriptions: Subscription[]) {
        return subscriptions.reduce((total, subscription) => {
            return total + subscription.unread.count;
        }, 0);
    }

    private computeTotalSubscriptionCount(subscriptions: Subscription[]) {
        return subscriptions.length;
    }

    update(subscriptions: Subscription[]) {
        return new AppHeaderState({
            totalUnread: this.computeTotalUnread(subscriptions),
            totalSubscriptionCount: this.computeTotalSubscriptionCount(subscriptions)
        });
    }
}

export class AppHeaderStore extends Store<AppHeaderState> {
    state: AppHeaderState;

    constructor(private repo: { subscriptionRepository: SubscriptionRepository }) {
        super();
        this.state = new AppHeaderState({
            totalUnread: 0,
            totalSubscriptionCount: 0
        });
    }

    receivePayload() {
        const subscriptions = this.repo.subscriptionRepository.getAll();
        this.setState(this.state.update(subscriptions));
    }

    getState(): AppHeaderState {
        return this.state;
    }
}
