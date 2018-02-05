// MIT © 2017 azu
import { Payload, UseCase } from "almin";
import { SubscriptionContentIdentifier } from "../../../../../../domain/Subscriptions/SubscriptionContent/SubscriptionContent";

export class ScrollToPrevContentUseCasePayload implements Payload {
    type = "ScrollToPrevContentUseCase";
    constructor(public subscriptionContentId: SubscriptionContentIdentifier) {}
}

export class ScrollToPrevContentUseCase extends UseCase {
    execute(subscriptionContentId: SubscriptionContentIdentifier) {
        this.dispatch(new ScrollToPrevContentUseCasePayload(subscriptionContentId));
    }
}
