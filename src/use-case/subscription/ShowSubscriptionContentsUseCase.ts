// MIT © 2017 azu
import { UseCase } from "almin";
import { subscriptionRepository, SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { SubscriptionIdentifier } from "../../domain/Subscriptions/Subscription";
import { InoreaderAPI } from "../../infra/api/InoreaderAPI";
import { createSubscriptionContentsFromResponse } from "../../domain/Subscriptions/SubscriptionContent/SubscriptionContentFactoryh";
import { isSatisfiedSubscriptionContentsFetchSpec } from "./spec/SubscriptionContentsFetchSpec";
import { appRepository, AppRepository } from "../../infra/repository/AppRepository";

export const createShowSubscriptionContentsUseCase = () => {
    return new ShowSubscriptionContentsUseCase({
        appRepository,
        subscriptionRepository
    });
};

export class ShowSubscriptionContentsUseCase extends UseCase {
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
        if (subscription.isContentsUpdating) {
            console.info(`This subscription is updating. No more update at once. ${subscription.id}`);
            return;
        }
        const specResult = isSatisfiedSubscriptionContentsFetchSpec(subscription);
        const app = this.repo.appRepository.get();
        if (!specResult.ok) {
            console.info(specResult.reason);
            app.user.openNewSubscription(subscription);
            return;
        }
        subscription.mutableBeginContentUpdating();
        const client = new InoreaderAPI();
        return client.streamContents(subscription, app.preferences.prefetchSubscriptionCount).then(response => {
            const subscriptionContents = createSubscriptionContentsFromResponse(response);
            const newSubscription = subscription.updateContents(subscriptionContents);
            newSubscription.mutableEndContentUpdating();
            this.repo.subscriptionRepository.save(newSubscription);
            app.user.openNewSubscription(newSubscription);
            this.repo.appRepository.save(app);
        });
    }
}
