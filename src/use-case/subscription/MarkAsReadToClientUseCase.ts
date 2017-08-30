// MIT © 2017 azu
import { UseCase } from "almin";
import { subscriptionRepository, SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { SubscriptionIdentifier } from "../../domain/Subscriptions/Subscription";

export const createMarkAsReadToClientUseCase = () => {
    return new MarkAsReadToClientUseCase({
        subscriptionRepository
    });
};

/**
 * Mark as read in client
 */
export class MarkAsReadToClientUseCase extends UseCase {
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
    }
}
