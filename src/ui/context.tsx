import { createContext, use, useSyncExternalStore } from "react";
import type { Reader, ReaderState } from "../app/reader.ts";
import type { Emitter } from "../lib/emitter.ts";
import type { Shortcuts } from "./shortcuts.ts";

export const ReaderContext = createContext<Reader | null>(null);
/** User script hooks: `window.userScript.event`. */
export const UserScriptEventsContext = createContext<Emitter | null>(null);
/** Key bindings, for controls that do the same as a key, including keys rebound by user scripts. */
export const ShortcutsContext = createContext<Shortcuts["bindings"] | null>(null);

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

export function useKeyBindings(): Shortcuts["bindings"] {
    const bindings = use(ShortcutsContext);
    if (!bindings) throw new Error("ShortcutsContext is missing");
    return bindings;
}
