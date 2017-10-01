// MIT © 2017 azu
import { UseCase } from "almin";
import { SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { SubscriptionIdentifier } from "../../domain/Subscriptions/Subscription";
import { InoreaderAPI } from "../../infra/api/InoreaderAPI";
import { createSubscriptionContentsFromResponse } from "../../domain/Subscriptions/SubscriptionContent/SubscriptionContentFactoryh";
import { AppRepository } from "../../infra/repository/AppRepository";
import { repositoryContainer } from "../../infra/repository/RepositoryContainer";
import { isSatisfiedSubscriptionContentsPrefetchSpec } from "./spec/SubscriptionContentsPrefetchSpec";

export const createPrefetchSubscriptContentsUseCase = () => {
    return new PrefetchSubscriptContentsUseCase(repositoryContainer.get());
};

export class PrefetchSubscriptContentsUseCase extends UseCase {
    constructor(
        private repo: {
            appRepository: AppRepository;
            subscriptionRepository: SubscriptionRepository;
        }
    ) {
        super();
    }

    execute(subscriptionId: SubscriptionIdentifier) {
        const subscription = this.repo.subscriptionRepository.findById(subscriptionId);
        if (!subscription) {
            throw new Error(`Not found subscription: ${subscriptionId}`);
        }
        const specResult = isSatisfiedSubscriptionContentsPrefetchSpec(subscription);
        if (!specResult.ok) {
            return;
        }
        const app = this.repo.appRepository.get();
        const client = new InoreaderAPI();
        return client.streamContents(subscription, app.preferences.fetchContentsCount).then(response => {
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
