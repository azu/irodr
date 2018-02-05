// MIT © 2017 azu
import { Payload, UseCase } from "almin";
import { SubscriptionContentIdentifier } from "../../../../../../domain/Subscriptions/SubscriptionContent/SubscriptionContent";

export class FocusContentUseCasePayload implements Payload {
    type = "FocusContentUseCasePayload";
    constructor(public contentId: SubscriptionContentIdentifier) {}
}

export class FocusContentUseCase extends UseCase {
    execute(contentId: SubscriptionContentIdentifier) {
        this.dispatch(new FocusContentUseCasePayload(contentId));
    }
}
