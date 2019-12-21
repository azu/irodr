// MIT © 2017 azu
import { NonNullableRepository } from "ddd-base";
import { App, AppJSON, AppSerializer } from "../../domain/App/App";
import { createStorageInstance } from "./Storage";

export class AppRepository extends NonNullableRepository<App> {
    storage: LocalForage;

    constructor(protected initialEntity: App) {
        super(initialEntity);
        this.storage = createStorageInstance({
            name: "AppRepository"
        });
    }

    /**
     * Please call this before find* API
     * @returns {Promise<any>}
     */
    async ready(): Promise<this> {
        if (this.map.size > 0) {
            return Promise.resolve(this);
        }
        await this.storage.ready();
        const values: AppJSON[] = [];
        await this.storage.iterate(value => {
            values.push(value as AppJSON);
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

    save(entity: App) {
        super.save(entity);
        return this.storage.setItem(entity.id.toValue(), AppSerializer.toJSON(entity));
    }

    clear() {
        super.clear();
        return this.storage.clear();
    }
}
