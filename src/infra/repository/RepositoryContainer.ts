// MIT © 2017 azu
import { createApp } from "../../domain/App/AppFactory";
import { AppRepository } from "./AppRepository";
import { SubscriptionRepository } from "./SubscriptionRepository";
import { ReadContentHistoryRepository } from "./ReadContentHistoryRepository";

export type RepositoryMap<T> = { [P in keyof T]: T[P] };

export class RepositoryContainer<T> {
    public repos: RepositoryMap<T>;

    constructor(container: RepositoryMap<T>) {
        this.repos = container;
    }

    /**
     * Get repository
     */
    get(): RepositoryMap<T> {
        return this.repos;
    }
}

export const repositoryContainer = new RepositoryContainer({
    appRepository: new AppRepository(createApp()),
    subscriptionRepository: new SubscriptionRepository(),
    readContentHistoryRepository: new ReadContentHistoryRepository()
});

export type RepositoryContainerRepos = (typeof repositoryContainer)["repos"];
