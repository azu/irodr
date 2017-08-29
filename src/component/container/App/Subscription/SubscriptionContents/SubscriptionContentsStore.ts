// MIT © 2017 azu
import { Store } from "almin";
import { SubscriptionRepository } from "../../../../../infra/repository/SubscriptionRepository";
import { SubscriptionContents } from "../../../../../domain/Subscriptions/SubscriptionContent/SubscriptionContents";
import {
    SubscriptionContent,
    SubscriptionContentIdentifier
} from "../../../../../domain/Subscriptions/SubscriptionContent/SubscriptionContent";
import { FocusContentUseCasePayload } from "./use-case/FocusContentUseCase";
import { AppRepository } from "../../../../../infra/repository/AppRepository";

export interface SubscriptionContentsStateProps {
    contents?: SubscriptionContents;
    focusContentId?: SubscriptionContentIdentifier;
}

export class SubscriptionContentsState {
    contents?: SubscriptionContents;
    focusContentId?: SubscriptionContentIdentifier;

    constructor(props: SubscriptionContentsStateProps) {
        this.contents = props.contents;
        this.focusContentId = props.focusContentId;
    }

    get hasContents(): boolean {
        return this.contents !== undefined && this.contents.hasContent;
    }

    getContentId(id: string): SubscriptionContentIdentifier {
        return new SubscriptionContentIdentifier(id);
    }

    isFocusContent(content: SubscriptionContent): boolean {
        return content.id.equals(this.focusContentId);
    }

    update(contents: SubscriptionContents) {
        if (this.contents === contents) {
            return this;
        }
        return new SubscriptionContentsState({
            contents
        });
    }

    reduce(payload: FocusContentUseCasePayload) {
        if (payload instanceof FocusContentUseCasePayload) {
            return new SubscriptionContentsState({
                ...this as SubscriptionContentsStateProps,
                focusContentId: payload.contentId
            });
        } else {
            return this;
        }
    }
}

export class SubscriptionContentsStore extends Store<SubscriptionContentsState> {
    state: SubscriptionContentsState;

    constructor(
        private repo: {
            appRepository: AppRepository;
            subscriptionRepository: SubscriptionRepository;
        }
    ) {
        super();
        this.state = new SubscriptionContentsState({});
    }

    receivePayload(payload: any) {
        const app = this.repo.appRepository.get();
        const currentActivityItem = app.user.subscriptionActivity.current;
        if (!currentActivityItem) {
            return;
        }
        const subscription = this.repo.subscriptionRepository.findById(currentActivityItem.id);
        if (!subscription) {
            return;
        }
        this.setState(this.state.update(subscription.contents).reduce(payload));
    }

    getState(): SubscriptionContentsState {
        return this.state;
    }
}
