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
import { Subscription } from "../../../../../domain/Subscriptions/Subscription";

export interface SubscriptionContentsStateProps {
    isContentsLoadings: boolean;
    subscription?: Subscription;
    rawContents?: SubscriptionContents;
    filteredContents?: SubscriptionContents;
    focusContentId?: SubscriptionContentIdentifier;
    // if exist it, scroll to ths id at once
    scrollContentId?: SubscriptionContentIdentifier;
}

export class SubscriptionContentsState {
    isContentsLoadings: boolean;
    subscription?: Subscription;
    rawContents?: SubscriptionContents;
    filteredContents?: SubscriptionContents;
    focusContentId?: SubscriptionContentIdentifier;
    scrollContentId?: SubscriptionContentIdentifier;

    constructor(props: SubscriptionContentsStateProps) {
        this.isContentsLoadings = props.isContentsLoadings;
        this.subscription = props.subscription;
        this.rawContents = props.rawContents;
        this.filteredContents = props.filteredContents;
        this.focusContentId = props.focusContentId;
        this.scrollContentId = props.scrollContentId;
    }

    get hasContents(): boolean {
        return this.filteredContents !== undefined && this.filteredContents.hasContent;
    }

    get contents(): SubscriptionContents | undefined {
        return this.filteredContents;
    }

    get contentsCount() {
        if (!this.contents) {
            return 0;
        }
        return this.contents.contents.length;
    }

    get unreadContentsCount() {
        if (!this.subscription) {
            return 0;
        }
        return this.subscription.unread.count;
    }

    get updatedContentsCount() {
        if (!this.subscription) {
            return 0;
        }
        const updatedCount = this.contentsCount - this.unreadContentsCount;
        if (updatedCount <= 0) return 0;
        return updatedCount;
    }

    getContentId(id: string): SubscriptionContentIdentifier {
        return new SubscriptionContentIdentifier(id);
    }

    getContent(id: SubscriptionContentIdentifier): SubscriptionContent | undefined {
        if (!this.filteredContents) {
            return;
        }
        const subscriptionContent = this.filteredContents.findContentById(id);
        if (!subscriptionContent) {
            return;
        }
        return subscriptionContent;
    }

    getFirstContent(): SubscriptionContent | undefined {
        if (!this.filteredContents) {
            return;
        }
        return this.filteredContents.contents[0];
    }

    getPrevContent(
        contentIdentifier: SubscriptionContentIdentifier | undefined = this.focusContentId
    ): SubscriptionContent | undefined {
        if (!this.filteredContents) {
            return;
        }

        if (!contentIdentifier) {
            return;
        }
        const subscriptionContent = this.filteredContents.findContentById(contentIdentifier);
        if (!subscriptionContent) {
            return;
        }
        return this.filteredContents.prevContentOf(subscriptionContent);
    }

    getNextContent(
        contentIdentifier: SubscriptionContentIdentifier | undefined = this.focusContentId
    ): SubscriptionContent | undefined {
        if (!this.filteredContents) {
            return;
        }
        if (!contentIdentifier) {
            return;
        }
        const subscriptionContent = this.filteredContents.findContentById(contentIdentifier);
        if (!subscriptionContent) {
            return;
        }
        return this.filteredContents.nextContentOf(subscriptionContent);
    }

    isFocusContent(content: SubscriptionContent): boolean {
        return content.id.equals(this.focusContentId);
    }

    update(subscription: Subscription) {
        const contents = subscription.contents;
        if (this.rawContents === contents) {
            return this;
        }
        // Notes: Define: Want to display time point A
        // 1. Search  Last Article that updateTime is larger than point A. (start index 0) - article index
        // 2. slice(0, articleIndex)
        // 3. the display list contains that the article updated time older than point A!
        const filteredContents = contents.getContentsNewerThanTheTime(subscription.unread.readTimestamp);
        return new SubscriptionContentsState({
            ...(this as SubscriptionContentsStateProps),
            subscription,
            rawContents: contents,
            filteredContents
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
                ...(this as SubscriptionContentsStateProps),
                focusContentId: payload.contentId
            });
        } else if (payload instanceof ScrollToNextContentUseCasePayload) {
            return new SubscriptionContentsState({
                ...(this as SubscriptionContentsStateProps),
                scrollContentId: payload.subscriptionContentId
            });
        } else if (payload instanceof ScrollToPrevContentUseCasePayload) {
            return new SubscriptionContentsState({
                ...(this as SubscriptionContentsStateProps),
                scrollContentId: payload.subscriptionContentId
            });
        } else if (payload instanceof StartLoadingPayload) {
            return new SubscriptionContentsState({
                ...(this as SubscriptionContentsStateProps),
                isContentsLoadings: true
            });
        } else if (payload instanceof FinishLoadingPayload) {
            return new SubscriptionContentsState({
                ...(this as SubscriptionContentsStateProps),
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
        this.setState(this.state.update(subscription).reduce(payload));
    }

    getState(): SubscriptionContentsState {
        return this.state;
    }
}
