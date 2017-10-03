// MIT © 2017 azu
import { UseCase } from "almin";
import { repositoryContainer } from "../../infra/repository/RepositoryContainer";
import { InoreaderAPI } from "../../infra/api/InoreaderAPI";
import { AppRepository } from "../../infra/repository/AppRepository";

export const createSaveInoreaderTokenUseCase = () => {
    return new SaveInoreaderTokenUseCase(repositoryContainer.get());
};

export class SaveInoreaderTokenUseCase extends UseCase {
    constructor(
        private repo: {
            appRepository: AppRepository;
        }
    ) {
        super();
    }

    execute(url: string) {
        const app = this.repo.appRepository.get();
        const client = new InoreaderAPI(app.user.authority);
        return client.saveTokenFromCallbackURL(url);
    }
}
