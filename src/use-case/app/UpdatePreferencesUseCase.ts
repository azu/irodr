// MIT © 2017 azu
import { UseCase } from "almin";
import { appRepository, AppRepository } from "../../infra/repository/AppRepository";

export const createUpdatePreferencesUseCase = () => {
    return new UpdatePreferencesUseCase({
        appRepository
    });
};
export class UpdatePreferencesUseCase extends UseCase {
    constructor(private repo: { appRepository: AppRepository }) {
        super();
    }

    execute() {
        const app = this.repo.appRepository.get();
        console.log(app);
    }
}
