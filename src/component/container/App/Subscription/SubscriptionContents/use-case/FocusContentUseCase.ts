// MIT © 2017 azu
import { Payload, UseCase } from "almin";
import { SubscriptionContentIdentifier } from "../../../../../../domain/Subscriptions/SubscriptionContent/SubscriptionContent";

export class FocusContentUseCasePayload extends Payload {
    constructor(public contentId: SubscriptionContentIdentifier) {
        super({ type: "FocusContentUseCasePayload" });
    }
}

export class FocusContentUseCase extends UseCase {
    execute(contentId: SubscriptionContentIdentifier) {
        this.dispatch(new FocusContentUseCasePayload(contentId));
    }
}
