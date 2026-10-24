import { createContext, use, useSyncExternalStore } from "react";
import type { Reader, ReaderState } from "../app/reader.ts";
import type { Emitter } from "../lib/emitter.ts";
import type { Shortcuts } from "./shortcuts.ts";

export const ReaderContext = createContext<Reader | null>(null);
/** User script hooks: `window.userScript.event`. */
export const UserScriptEventsContext = createContext<Emitter | null>(null);
/** Keyboard shortcut actions, for controls that do the same as a key. */
export const ShortcutsContext = createContext<Shortcuts["actions"] | null>(null);

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

export function useShortcutActions(): Shortcuts["actions"] {
    const actions = use(ShortcutsContext);
    if (!actions) throw new Error("ShortcutsContext is missing");
    return actions;
}
