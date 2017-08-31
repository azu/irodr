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
import { ScrollToNextContentUseCasePayload } from "./use-case/ScrollToNextContentUseCase";
import { ScrollToPrevContentUseCasePayload } from "./use-case/ScrollToPrevContentUseCase";
import {
    FinishLoadingPayload,
    StartLoadingPayload
} from "../../../../../use-case/subscription/ShowSubscriptionContentsUseCase";

export interface SubscriptionContentsStateProps {
    isContentsLoadings: boolean;
    contents?: SubscriptionContents;
    focusContentId?: SubscriptionContentIdentifier;
    // if exist it, scroll to ths id at once
    scrollContentId?: SubscriptionContentIdentifier;
}

export class SubscriptionContentsState {
    isContentsLoadings: boolean;
    contents?: SubscriptionContents;
    focusContentId?: SubscriptionContentIdentifier;
    scrollContentId?: SubscriptionContentIdentifier;

    constructor(props: SubscriptionContentsStateProps) {
        this.isContentsLoadings = props.isContentsLoadings;
        this.contents = props.contents;
        this.focusContentId = props.focusContentId;
        this.scrollContentId = props.scrollContentId;
    }

    get hasContents(): boolean {
        return this.contents !== undefined && this.contents.hasContent;
    }

    getContentId(id: string): SubscriptionContentIdentifier {
        return new SubscriptionContentIdentifier(id);
    }

    getContent(id: SubscriptionContentIdentifier): SubscriptionContent | undefined {
        if (!this.contents) {
            return;
        }
        const subscriptionContent = this.contents.findContentById(id);
        if (!subscriptionContent) {
            return;
        }
        return subscriptionContent;
    }

    getPrevContent(
        contentIdentifier: SubscriptionContentIdentifier | undefined = this.focusContentId
    ): SubscriptionContent | undefined {
        if (!this.contents) {
            return;
        }

        if (!contentIdentifier) {
            return;
        }
        const subscriptionContent = this.contents.findContentById(contentIdentifier);
        if (!subscriptionContent) {
            return;
        }
        return this.contents.prevContentOf(subscriptionContent);
    }

    getNextContent(
        contentIdentifier: SubscriptionContentIdentifier | undefined = this.focusContentId
    ): SubscriptionContent | undefined {
        if (!this.contents) {
            return;
        }
        if (!contentIdentifier) {
            return;
        }
        const subscriptionContent = this.contents.findContentById(contentIdentifier);
        if (!subscriptionContent) {
            return;
        }
        return this.contents.nextContentOf(subscriptionContent);
    }

    isFocusContent(content: SubscriptionContent): boolean {
        return content.id.equals(this.focusContentId);
    }

    update(contents: SubscriptionContents) {
        if (this.contents === contents) {
            return this;
        }
        return new SubscriptionContentsState({
            ...this as SubscriptionContentsStateProps,
            contents
        });
    }

    reduce(
        payload:
            | FocusContentUseCasePayload
            | ScrollToNextContentUseCasePayload
            | ScrollToPrevContentUseCasePayload
            | StartLoadingPayload
            | FinishLoadingPayload
    ) {
        if (payload instanceof FocusContentUseCasePayload) {
            return new SubscriptionContentsState({
                ...this as SubscriptionContentsStateProps,
                focusContentId: payload.contentId
            });
        } else if (payload instanceof ScrollToNextContentUseCasePayload) {
            return new SubscriptionContentsState({
                ...this as SubscriptionContentsStateProps,
                scrollContentId: payload.subscriptionContentId
            });
        } else if (payload instanceof ScrollToPrevContentUseCasePayload) {
            return new SubscriptionContentsState({
                ...this as SubscriptionContentsStateProps,
                scrollContentId: payload.subscriptionContentId
            });
        } else if (payload instanceof StartLoadingPayload) {
            return new SubscriptionContentsState({
                ...this as SubscriptionContentsStateProps,
                isContentsLoadings: true
            });
        } else if (payload instanceof FinishLoadingPayload) {
            return new SubscriptionContentsState({
                ...this as SubscriptionContentsStateProps,
                isContentsLoadings: false
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
        this.state = new SubscriptionContentsState({
            isContentsLoadings: false
        });
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
