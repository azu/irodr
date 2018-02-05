// MIT © 2017 azu
import { Payload, UseCase } from "almin";
import { SubscriptionContentIdentifier } from "../../../../../../domain/Subscriptions/SubscriptionContent/SubscriptionContent";

export class ScrollToNextContentUseCasePayload implements Payload {
    type = "ScrollToNextContentUseCase";

    constructor(public subscriptionContentId: SubscriptionContentIdentifier) {}
}

export class ScrollToNextContentUseCase extends UseCase {
    execute(subscriptionContentId: SubscriptionContentIdentifier) {
        this.dispatch(new ScrollToNextContentUseCasePayload(subscriptionContentId));
    }
}
