/** A minimal external store for `useSyncExternalStore` and source snapshots. */
export class Store<T> {
    #state: T;
    readonly #listeners = new Set<() => void>();

    constructor(initial: T) {
        this.#state = initial;
    }

    get = (): T => this.#state;

    subscribe = (listener: () => void): (() => void) => {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    };

    set(next: T): void {
        if (Object.is(next, this.#state)) return;
        this.#state = next;
        for (const listener of Array.from(this.#listeners)) listener();
    }

    update(change: (current: T) => T): void {
        this.set(change(this.#state));
    }
}
