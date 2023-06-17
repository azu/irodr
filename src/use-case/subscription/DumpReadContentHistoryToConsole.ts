// MIT © 2017 azu
import { UseCase } from "almin";
import { repositoryContainer, RepositoryContainerRepos } from "../../infra/repository/RepositoryContainer";

export const createDumpReadContentHistoryToConsole = () => {
    return new DumpReadContentHistoryToConsole(repositoryContainer.get());
};

export class DumpReadContentHistoryToConsole extends UseCase {
    constructor(private repo: RepositoryContainerRepos) {
        super();
    }

    execute() {
        const readContents = this.repo.readContentHistoryRepository.getAll();
        console.log(readContents);
    }
}
