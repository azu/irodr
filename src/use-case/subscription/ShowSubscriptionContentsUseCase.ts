// MIT © 2017 azu
import { Payload, UseCase } from "almin";
import { subscriptionRepository, SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { SubscriptionIdentifier } from "../../domain/Subscriptions/Subscription";
import { InoreaderAPI } from "../../infra/api/InoreaderAPI";
import { createSubscriptionContentsFromResponse } from "../../domain/Subscriptions/SubscriptionContent/SubscriptionContentFactoryh";
import { isSatisfiedSubscriptionContentsFetchSpec } from "./spec/SubscriptionContentsFetchSpec";

export const createShowSubscriptionContentsUseCase = () => {
    return new ShowSubscriptionContentsUseCase({
        subscriptionRepository
    });
};

export class ShowSubscriptionContentsUseCasePayload extends Payload {
    constructor(public subscriptionId: SubscriptionIdentifier) {
        super({ type: "ShowSubscriptionContentsUseCasePayload" });
    }
}

export class ShowSubscriptionContentsUseCase extends UseCase {
    constructor(private repo: { subscriptionRepository: SubscriptionRepository }) {
        super();
    }

    execute(subscriptionId: SubscriptionIdentifier) {
        const subscription = this.repo.subscriptionRepository.findById(subscriptionId);
        if (!subscription) {
            throw new Error(`Not found subscription: ${subscriptionId}`);
        }
        if (subscription.isContentsUpdating) {
            console.info(`This subscription is updating. No more update at once. ${subscription.id}`);
            return;
        }
        const specResult = isSatisfiedSubscriptionContentsFetchSpec(subscription);
        if (!specResult.ok) {
            console.info(specResult.reason);
            this.dispatch(new ShowSubscriptionContentsUseCasePayload(subscriptionId));
            return;
        }
        subscription.mutableBeginContentUpdating();
        const client = new InoreaderAPI();
        return client
            .streamContents(subscription)
            .then(response => {
                const subscriptionContents = createSubscriptionContentsFromResponse(response);
                const newSubscription = subscription.updateContents(subscriptionContents);
                newSubscription.mutableEndContentUpdating();
                this.repo.subscriptionRepository.save(newSubscription);
            })
            .then(() => {
                this.dispatch(new ShowSubscriptionContentsUseCasePayload(subscriptionId));
            });
    }
}
