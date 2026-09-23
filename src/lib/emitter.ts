export type Handler = (...args: unknown[]) => void;

/** Event hub exposed to user scripts as `window.userScript.event`. */
export interface Emitter {
    /** Returns a function that unsubscribes `handler`. */
    subscribe: (event: string, handler: Handler) => () => void;
    dispatch: (event: string, ...args: unknown[]) => void;
}

export function createEmitter(): Emitter {
    const handlers = new Map<string, Set<Handler>>();
    return {
        subscribe: (event, handler) => {
            const eventHandlers = handlers.get(event) ?? new Set<Handler>();
            handlers.set(event, eventHandlers);
            eventHandlers.add(handler);
            return () => {
                eventHandlers.delete(handler);
            };
        },
        dispatch: (event, ...args) => {
            for (const handler of Array.from(handlers.get(event) ?? [])) {
                try {
                    handler(...args);
                } catch (error) {
                    // A broken user script must not break the reader.
                    console.error(error);
                }
            }
        }
    };
}
