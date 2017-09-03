// MIT © 2017 azu
import { Store } from "almin";
import { SubscriptionRepository } from "../../../../infra/repository/SubscriptionRepository";
import { Subscription } from "../../../../domain/Subscriptions/Subscription";
import { UpdateHeaderMessageUseCasePayload } from "../../../../use-case/app/UpdateHeaderMessageUseCase";

export interface AppHeaderStateProps {
    message: string;
    totalUnread: number;
    totalSubscriptionCount: number;
}

export class AppHeaderState {
    message: string;
    totalUnread: number;
    totalSubscriptionCount: number;

    constructor(props: AppHeaderStateProps) {
        this.message = props.message;
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
            ...this as AppHeaderStateProps,
            totalUnread: this.computeTotalUnread(subscriptions),
            totalSubscriptionCount: this.computeTotalSubscriptionCount(subscriptions)
        });
    }

    reduce(payload: UpdateHeaderMessageUseCasePayload) {
        if (payload instanceof UpdateHeaderMessageUseCasePayload) {
            return new AppHeaderState({
                ...this as AppHeaderStateProps,
                message: payload.message
            });
        }
        return this;
    }
}

export class AppHeaderStore extends Store<AppHeaderState> {
    state: AppHeaderState;

    constructor(private repo: { subscriptionRepository: SubscriptionRepository }) {
        super();
        this.state = new AppHeaderState({
            message: "No messages",
            totalUnread: 0,
            totalSubscriptionCount: 0
        });
    }

    receivePayload(payload: any) {
        const subscriptions = this.repo.subscriptionRepository.getAll();
        this.setState(this.state.update(subscriptions).reduce(payload));
    }

    getState(): AppHeaderState {
        return this.state;
    }
}
