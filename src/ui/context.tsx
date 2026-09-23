import { createContext, use, useSyncExternalStore } from "react";
import type { Reader, ReaderState } from "../app/reader.ts";
import type { Emitter } from "../lib/emitter.ts";

export const ReaderContext = createContext<Reader | null>(null);
/** User script hooks: `window.userScript.event`. */
export const UserScriptEventsContext = createContext<Emitter | null>(null);

export function useReader(): Reader {
    const reader = use(ReaderContext);
    if (!reader) throw new Error("ReaderContext is missing");
    return reader;
}

/** Subscribe to a slice of the reader state. `selector` must return stable values. */
export function useReaderState<T>(selector: (state: ReaderState) => T): T {
    const reader = useReader();
    return useSyncExternalStore(reader.subscribe, () => selector(reader.getState()));
}

export function useUserScriptEvents(): Emitter | null {
    return use(UserScriptEventsContext);
}
