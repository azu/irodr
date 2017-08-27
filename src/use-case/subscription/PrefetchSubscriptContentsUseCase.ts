// MIT © 2017 azu
import { UseCase } from "almin";
import { subscriptionRepository, SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { SubscriptionIdentifier } from "../../domain/Subscriptions/Subscription";
import { InoreaderAPI } from "../../infra/api/InoreaderAPI";
import { createSubscriptionContentsFromResponse } from "../../domain/Subscriptions/SubscriptionContent/SubscriptionContentFactoryh";
import { isSatisfiedSubscriptionContentsFetchSpec } from "./spec/SubscriptionContentsFetchSpec";

export const createPrefetchSubscriptContentsUseCase = () => {
    return new PrefetchSubscriptContentsUseCase({
        subscriptionRepository
    });
};

export class PrefetchSubscriptContentsUseCase extends UseCase {
    constructor(private repo: { subscriptionRepository: SubscriptionRepository }) {
        super();
    }

    execute(subscriptionId: SubscriptionIdentifier) {
        const subscription = this.repo.subscriptionRepository.findById(subscriptionId);
        if (!subscription) {
            throw new Error(`Not found subscription: ${subscriptionId}`);
        }
        const specResult = isSatisfiedSubscriptionContentsFetchSpec(subscription);
        if (!specResult.ok) {
            return;
        }
        const client = new InoreaderAPI();
        return client.streamContents(subscription).then(response => {
            // get again, because async
            const oldSubscription = this.repo.subscriptionRepository.findById(subscriptionId);
            if (!oldSubscription) {
                return;
            }
            const subscriptionContents = createSubscriptionContentsFromResponse(response);
            const newSubscription = oldSubscription.updateContents(subscriptionContents);
            this.repo.subscriptionRepository.save(newSubscription);
        });
    }
}
