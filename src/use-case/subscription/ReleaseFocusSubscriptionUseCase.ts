import { UseCase } from "almin";
import { repositoryContainer } from "../../infra/repository/RepositoryContainer";

export const createReleaseFocusSubscriptionUseCase = () => {
    return new ReleaseFocusSubscriptionUseCase(repositoryContainer.get());
};

export class ReleaseFocusSubscriptionUseCase extends UseCase {
    constructor(private repositoryMap: typeof repositoryContainer.repos) {
        super();
    }

    execute() {
        const app = this.repositoryMap.appRepository.get();
        if (!app) {
            throw new Error("Not found app");
        }
        app.user.pretendDidNotOpenCurrentSubscription();
        this.repositoryMap.appRepository.save(app);
    }
}
