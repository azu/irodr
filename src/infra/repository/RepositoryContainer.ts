// MIT © 2017 azu
import { createApp } from "../../domain/App/AppFactory";
import { AppRepository } from "./AppRepository";
import { SubscriptionRepository } from "./SubscriptionRepository";

export type RepositoryMap<T> = { [P in keyof T]: T[P] };

export class RepositoryContainer<T> {
    constructor(private container: RepositoryMap<T>) {}

    /**
     * Get repository
     */
    get() {
        return this.container;
    }
}

export const repositoryContainer = new RepositoryContainer({
    appRepository: new AppRepository(createApp()),
    subscriptionRepository: new SubscriptionRepository()
});
