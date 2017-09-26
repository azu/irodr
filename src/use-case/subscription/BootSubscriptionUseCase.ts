// MIT © 2017 azu
import { UseCase } from "almin";
import { subscriptionRepository, SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
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
        await this.repo.appRepository.ready();
    }
}
