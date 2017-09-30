// MIT © 2017 azu
import { UseCase } from "almin";
import { SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { AppRepository } from "../../infra/repository/AppRepository";
import { repositoryContainer } from "../../infra/repository/RepositoryContainer";

export const createBootSubscriptionUseCase = () => {
    return new BootSubscriptionUseCase(repositoryContainer.get());
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
