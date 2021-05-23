// MIT © 2017 azu
import { UseCase } from "almin";
import { SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { SubscriptionIdentifier } from "../../domain/Subscriptions/Subscription";
import { InoreaderAPI } from "../../infra/api/InoreaderAPI";
import { repositoryContainer } from "../../infra/repository/RepositoryContainer";
import { AppRepository } from "../../infra/repository/AppRepository";

export const createMarkAsReadToServerUseCase = () => {
    return new MarkAsReadToServerUseCase(repositoryContainer.get());
};

/**
 *  Mark as read in client and server
 */
export class MarkAsReadToServerUseCase extends UseCase {
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
            throw new Error(`Not found subscription:${subscriptionId}`);
        }
        const readSubscription = subscription.readAll();
        this.repo.subscriptionRepository.save(readSubscription);
        // send to server
        const app = this.repo.appRepository.get();
        const client = new InoreaderAPI(app.user.authority);
        return client.markAsRead(subscription).catch((error) => {
            console.error(error);
            // revert
            this.repo.subscriptionRepository.save(subscription);
        });
    }
}
