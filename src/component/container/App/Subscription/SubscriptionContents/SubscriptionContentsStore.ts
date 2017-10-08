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
import {
    TurnOffContentsFilterUseCasePayload,
    TurnOnContentsFilterUseCasePayload
} from "./use-case/ToggleFilterContents";

export interface SubscriptionContentsStateProps {
    isContentsLoadings: boolean;
    enableContentFilter: boolean;
    subscription?: Subscription;
    rawContents?: SubscriptionContents;
    filteredContents?: SubscriptionContents;
    focusContentId?: SubscriptionContentIdentifier;
    // if exist it, scroll to ths id at once
    scrollContentId?: SubscriptionContentIdentifier;
}

export enum SubscriptionContentType {
    UNKNOWN,
    NEW,
    UPDATED
}

export class SubscriptionContentsState {
    isContentsLoadings: boolean;
    enableContentFilter: boolean;
    subscription?: Subscription;
    rawContents?: SubscriptionContents;
    filteredContents?: SubscriptionContents;
    focusContentId?: SubscriptionContentIdentifier;
    scrollContentId?: SubscriptionContentIdentifier;

    constructor(props: SubscriptionContentsStateProps) {
        this.isContentsLoadings = props.isContentsLoadings;
        this.enableContentFilter = props.enableContentFilter;
        this.subscription = props.subscription;
        this.rawContents = props.rawContents;
        this.filteredContents = props.filteredContents;
        this.focusContentId = props.focusContentId;
        this.scrollContentId = props.scrollContentId;
    }

    get hasContents(): boolean {
        return this.contents !== undefined && this.contents.hasContent;
    }

    get contents(): SubscriptionContents | undefined {
        if (!this.enableContentFilter) {
            return this.rawContents;
        }
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
        if (!this.contents) {
            return;
        }
        const subscriptionContent = this.contents.findContentById(id);
        if (!subscriptionContent) {
            return;
        }
        return subscriptionContent;
    }

    getFirstContent(): SubscriptionContent | undefined {
        if (!this.contents) {
            return;
        }
        return this.contents.contents[0];
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

    getTypeOfContent(content: SubscriptionContent): SubscriptionContentType {
        const subscription = this.subscription;
        if (!subscription) {
            return SubscriptionContentType.UNKNOWN;
        }
        if (
            content.publishedDate.compare("<=", subscription.unread.readTimestamp) &&
            content.updatedDate.compare(">=", subscription.unread.readTimestamp)
        ) {
            return SubscriptionContentType.UPDATED;
        }
        return SubscriptionContentType.NEW;
    }

    isFocusContent(content: SubscriptionContent): boolean {
        return content.id.equals(this.focusContentId);
    }

    update(subscription: Subscription) {
        const contents = subscription.contents;
        if (this.rawContents === contents) {
            return this;
        }

        const isChangedSubscription = subscription.equals(this.subscription) === false;
        // Notes: Define: Want to display time point A
        // 1. Search  Last Article that updateTime is larger than point A. (start index 0) - article index
        // 2. slice(0, articleIndex)
        // 3. the display list contains that the article updated time older than point A!
        const filteredContents = contents.getContentsNewerThanTheTime(
            // insteadof subscription.unread.readTimestamp
            // because, want to show old article when next and back ASAP
            subscription.lastUpdated,
            subscription.unread.count
        );
        return new SubscriptionContentsState({
            ...(this as SubscriptionContentsStateProps),
            subscription,
            rawContents: contents,
            filteredContents,
            enableContentFilter: isChangedSubscription // Enable filter again when Update contents
        });
    }

    reduce(
        payload:
            | FocusContentUseCasePayload
            | ScrollToNextContentUseCasePayload
            | ScrollToPrevContentUseCasePayload
            | StartLoadingPayload
            | FinishLoadingPayload
            | TurnOffContentsFilterUseCasePayload
            | TurnOnContentsFilterUseCasePayload
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
        } else if (payload instanceof TurnOnContentsFilterUseCasePayload) {
            return new SubscriptionContentsState({
                ...(this as SubscriptionContentsStateProps),
                enableContentFilter: true
            });
        } else if (payload instanceof TurnOffContentsFilterUseCasePayload) {
            return new SubscriptionContentsState({
                ...(this as SubscriptionContentsStateProps),
                enableContentFilter: false
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
            enableContentFilter: true,
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
