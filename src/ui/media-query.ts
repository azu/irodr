import { useSyncExternalStore } from "react";

/** Whether `query` matches, updated when it changes; e.g. when iPhone Duo is folded or unfolded. */
export function useMediaQuery(query: string): boolean {
    return useSyncExternalStore(
        (notify) => {
            const list = window.matchMedia(query);
            list.addEventListener("change", notify);
            return () => list.removeEventListener("change", notify);
        },
        () => window.matchMedia(query).matches
    );
}
