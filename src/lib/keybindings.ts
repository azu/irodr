export type KeyHandler = (event: KeyboardEvent) => void;

const MODIFIERS = ["ctrl", "alt", "meta", "shift"] as const;

const KEY_ALIASES: Record<string, string> = { " ": "space", spacebar: "space", esc: "escape" };

/** Normalize "Shift+J" / "shift+j" to "shift+j" with modifiers in a fixed order. */
export function normalizeCombo(combo: string): string {
    const parts = combo
        .toLowerCase()
        .split("+")
        .map((part) => part.trim());
    const key = parts.pop() ?? "";
    const modifiers = MODIFIERS.filter((modifier) => parts.includes(modifier));
    return [...modifiers, KEY_ALIASES[key] ?? key].join("+");
}

export function comboFromEvent(
    event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">
): string {
    const key = event.key.toLowerCase();
    const pressed = { ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey, shift: event.shiftKey };
    return [...MODIFIERS.filter((modifier) => pressed[modifier]), KEY_ALIASES[key] ?? key].join("+");
}

/** Typing in form fields must not trigger reader shortcuts. */
export function isEditableTarget(target: EventTarget | null): boolean {
    if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
    return target.isContentEditable || target.closest("input, textarea, select") !== null;
}

/** A tiny replacement for Combokeys: one listener, exact-modifier matching. */
export class KeyBindings {
    readonly #handlers = new Map<string, KeyHandler[]>();

    bind(combo: string, handler: KeyHandler): () => void {
        const key = normalizeCombo(combo);
        this.#handlers.set(key, [...(this.#handlers.get(key) ?? []), handler]);
        return () => {
            this.#handlers.set(
                key,
                (this.#handlers.get(key) ?? []).filter((candidate) => candidate !== handler)
            );
        };
    }

    has(combo: string): boolean {
        return (this.#handlers.get(normalizeCombo(combo))?.length ?? 0) > 0;
    }

    /** Run the handlers bound to `combo`, as if the keys were pressed. */
    trigger(combo: string, event: KeyboardEvent = new KeyboardEvent("keydown")): boolean {
        const handlers = this.#handlers.get(normalizeCombo(combo)) ?? [];
        for (const handler of handlers) handler(event);
        return handlers.length > 0;
    }

    handleEvent(event: KeyboardEvent): void {
        if (event.defaultPrevented || event.isComposing || isEditableTarget(event.target)) return;
        this.trigger(comboFromEvent(event), event);
    }
}
