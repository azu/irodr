// MIT © 2017 azu
import { Store } from "almin";
import { SubscriptionRepository } from "../../../../../infra/repository/SubscriptionRepository";
import { SubscriptionContents } from "../../../../../domain/Subscriptions/SubscriptionContent/SubscriptionContents";
import { ShowSubscriptionContentsUseCasePayload } from "../../../../../use-case/subscription/ShowSubscriptionContentsUseCase";

export interface SubscriptionContentsStateProps {
    contents?: SubscriptionContents;
}

export class SubscriptionContentsState {
    contents?: SubscriptionContents;

    constructor(props: SubscriptionContentsStateProps) {
        this.contents = props.contents;
    }

    get hasContents(): boolean {
        return this.contents !== undefined && this.contents.hasContent;
    }

    update(contents: SubscriptionContents) {
        if (this.contents === contents) {
            return this;
        }
        return new SubscriptionContentsState({
            contents
        });
    }
}

export class SubscriptionContentsStore extends Store<SubscriptionContentsState> {
    state: SubscriptionContentsState;

    constructor(private repo: { subscriptionRepository: SubscriptionRepository }) {
        super();
        this.state = new SubscriptionContentsState({});
    }

    receivePayload(payload: ShowSubscriptionContentsUseCasePayload) {
        if (payload instanceof ShowSubscriptionContentsUseCasePayload) {
            const subscription = this.repo.subscriptionRepository.findById(payload.subscriptionId);
            if (!subscription) {
                return;
            }
            this.setState(this.state.update(subscription.contents));
        }
    }

    getState(): SubscriptionContentsState {
        return this.state;
    }
}
