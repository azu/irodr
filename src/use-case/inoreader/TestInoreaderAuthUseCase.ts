// MIT © 2017 azu
import { UseCase } from "almin";
import { repositoryContainer } from "../../infra/repository/RepositoryContainer";
import { AppRepository } from "../../infra/repository/AppRepository";
import { InoreaderAPI } from "../../infra/api/InoreaderAPI";

export const createTestInoreaderAuthUseCase = () => {
    return new TestInoreaderAuthUseCase(repositoryContainer.get());
};

export class TestInoreaderAuthUseCase extends UseCase {
    constructor(
        private repo: {
            appRepository: AppRepository;
        }
    ) {
        super();
    }

    execute() {
        if (0 < 1) {
            return Promise.reject("error");
        }
        const app = this.repo.appRepository.get();
        const client = new InoreaderAPI(app.user.authority);
        return client.getToken().catch(error => {
            return Promise.reject(new Error(`Inoreader token is invalid`));
        });
    }
}
