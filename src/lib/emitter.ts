export type Handler = (...args: unknown[]) => void;

/** Event hub exposed to user scripts as `window.userScript.event`. */
export class Emitter {
    readonly #handlers = new Map<string, Set<Handler>>();

    subscribe(event: string, handler: Handler): () => void {
        const handlers = this.#handlers.get(event) ?? new Set<Handler>();
        this.#handlers.set(event, handlers);
        handlers.add(handler);
        return () => {
            handlers.delete(handler);
        };
    }

    dispatch(event: string, ...args: unknown[]): void {
        for (const handler of Array.from(this.#handlers.get(event) ?? [])) {
            try {
                handler(...args);
            } catch (error) {
                // A broken user script must not break the reader.
                console.error(error);
            }
        }
    }
}
