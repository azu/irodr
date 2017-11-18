// MIT © 2017 azu
import { UseCase } from "almin";
import { SubscriptionRepository } from "../../infra/repository/SubscriptionRepository";
import { AppRepository } from "../../infra/repository/AppRepository";
import { repositoryContainer } from "../../infra/repository/RepositoryContainer";
import { createMachineUser } from "../../domain/App/User/AppUserFactory";
import { createSubscriptionsFromResponses } from "../../domain/Subscriptions/SubscriptionFactory";

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

    async execute(url: string) {
        await this.repo.appRepository.ready();
        const app = this.repo.appRepository.get();
        if (Boolean(process.env.SSR)) {
            const machineUser = createMachineUser();
            const machineApp = app.updateUser(machineUser);
            this.repo.appRepository.save(machineApp);
            return;
        }
        const parsedURL = new URL(url);
        if (parsedURL.searchParams.has("ci")) {
            const machineUser = createMachineUser();
            const machineApp = app.updateUser(machineUser);
            this.repo.appRepository.save(machineApp);
            try {
                const subscriptions = createSubscriptionsFromResponses(
                    require("./ci/subscriptions.json"),
                    require("./ci/unread.json")
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
