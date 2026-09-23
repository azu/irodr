/** A minimal external store for `useSyncExternalStore` and source snapshots. */
export interface Store<T> {
    get: () => T;
    /** Returns a function that unsubscribes `listener`. */
    subscribe: (listener: () => void) => () => void;
    /** Replace the value and notify the subscribers. Setting the current value (`Object.is`) does nothing. */
    set: (next: T) => void;
    update: (change: (current: T) => T) => void;
}

export function createStore<T>(initial: T): Store<T> {
    const cell = { value: initial };
    const listeners = new Set<() => void>();

    const set = (next: T): void => {
        if (Object.is(next, cell.value)) return;
        cell.value = next;
        for (const listener of Array.from(listeners)) listener();
    };

    return {
        get: () => cell.value,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        set,
        update: (change) => set(change(cell.value))
    };
}
