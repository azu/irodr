// MIT © 2017 azu
import localForage from "localforage";

const memoryStorageDriver = require("localforage-memoryStorageDriver");

export class StorageManger {
    currentDriver?: string;
    instances: [LocalForage, string][] = [];

    addInstance(instance: LocalForage) {
        this.instances.push([instance, instance.driver()]);
    }

    async useMemoryDriver() {
        await localForage.defineDriver(memoryStorageDriver);
        await localForage.setDriver(memoryStorageDriver._driver);
        await localForage.ready();
        this.currentDriver = memoryStorageDriver._driver;
        const promises = this.instances.map(async ([instance]) => {
            await instance.defineDriver(memoryStorageDriver);
            await instance.setDriver(memoryStorageDriver._driver);
            await instance.ready();
        });
        return Promise.all(promises);
    }

    async resetDriver() {
        const promises = this.instances.map(([instance, driver]) => {
            return instance.setDriver(driver);
        });
        this.currentDriver = undefined;
        return Promise.all(promises);
    }
}

// singleton
export const storageManger = new StorageManger();

/**
 * Storage is a wrapper of localForage
 * It can change driver at runtime for debugging.
 */
export function createStorageInstance(options: LocalForageOptions): LocalForage {
    const defaultOptions = storageManger.currentDriver
        ? {
              driver: storageManger.currentDriver
          }
        : {};
    const instance = localForage.createInstance(Object.assign({}, defaultOptions, options));
    storageManger.addInstance(instance);
    return instance;
}
