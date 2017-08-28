// MIT © 2017 azu
import { NonNullableRepository } from "ddd-base";
import { App, AppJSON, AppSerializer } from "../../domain/App/App";
import { createApp } from "../../domain/App/AppFactory";
import { createStorageInstance } from "./Storage";

export class AppRepository extends NonNullableRepository<App> {
    storage: LocalForage;

    /**
     * Please call this before find* API
     * @returns {Promise<any>}
     */
    async ready(): Promise<this> {
        if (this.map.size > 0) {
            return Promise.resolve(this);
        }
        this.storage = createStorageInstance({
            name: "AppRepository"
        });
        await this.storage.ready();
        const values: AppJSON[] = [];
        await this.storage.iterate(value => {
            values.push(value);
        });
        values
            .map(json => {
                try {
                    return AppSerializer.fromJSON(json);
                } catch (error) {
                    this.storage.removeItem(json.id);
                    return this.initialEntity;
                }
            })
            .forEach(app => {
                this.save(app);
            });
        return this;
    }
}

export const appRepository = new AppRepository(createApp());
