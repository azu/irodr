// MIT © 2017 azu
import { UseCase } from "almin";
import { subscriptionRepository, SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { createSubscriptionsFromResponses } from "../../domain/Subscriptions/SubscriptionFactory";
import { appRepository, AppRepository } from "../../infra/repository/AppRepository";

export const createBootSubscriptionUseCase = () => {
    return new BootSubscriptionUseCase({
        appRepository,
        subscriptionRepository
    });
};

export class BootSubscriptionUseCase extends UseCase {
    constructor(
        private repo: {
            appRepository: AppRepository;
            subscriptionRepository: SubscriptionRepository;
        }
    ) {
        super();
    }

    async execute() {
        await appRepository.ready();
        if (process.env.NODE_ENV !== "production") {
            try {
                const subscriptions = createSubscriptionsFromResponses(
                    require("./__fixtures__/subscriptions.json"),
                    require("./__fixtures__/unread.json")
                );
                subscriptions.forEach(subscription => {
                    this.repo.subscriptionRepository.save(subscription);
                });
            } catch (error) {
                console.info("No fixtures data");
            }
        }
    }
}
