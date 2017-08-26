// MIT © 2017 azu
import { UseCase } from "almin";
import { subscriptionRepository, SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { createSubscriptionsFromResponses } from "../../domain/Subscriptions/SubscriptionFactory";

export const createBootSubscriptionUseCase = () => {
    return new BootSubscriptionUseCase({
        subscriptionRepository
    });
};

export class BootSubscriptionUseCase extends UseCase {
    constructor(private repo: { subscriptionRepository: SubscriptionRepository }) {
        super();
    }

    execute() {
        const subscriptions = createSubscriptionsFromResponses(
            require("./__fixtures__/subscriptions.json"),
            require("./__fixtures__/unread.json")
        );
        subscriptions.forEach(subscription => {
            this.repo.subscriptionRepository.save(subscription);
        });
    }
}
