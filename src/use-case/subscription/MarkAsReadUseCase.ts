// MIT © 2017 azu
import { UseCase } from "almin";
import { subscriptionRepository, SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { SubscriptionIdentifier } from "../../domain/Subscriptions/Subscription";
import { InoreaderAPI } from "../../infra/api/InoreaderAPI";

export const createMarkAsReadUseCase = () => {
    return new MarkAsReadUseCase({
        subscriptionRepository
    });
};

export class MarkAsReadUseCase extends UseCase {
    constructor(
        private repo: {
            subscriptionRepository: SubscriptionRepository;
        }
    ) {
        super();
    }

    execute(subscriptionId: SubscriptionIdentifier) {
        const subscription = this.repo.subscriptionRepository.findById(subscriptionId);
        if (!subscription) {
            throw new Error(`Not found subscription:${subscriptionId}`);
        }
        const newSubscription = subscription.readAll();
        this.repo.subscriptionRepository.save(newSubscription);
        //
        const client = new InoreaderAPI();
        return client.markAsRead(subscription).catch(error => {
            console.error(error);
            // revert
            this.repo.subscriptionRepository.save(subscription);
        });
    }
}
