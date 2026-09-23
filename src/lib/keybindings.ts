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

/**
 * The key name, independent of non-Latin keyboard layouts: with a Russian layout, the J key
 * produces "о" but its `code` is still "KeyJ". Combokeys (irodr 1.x) matched key codes too.
 */
function keyName(event: Pick<KeyboardEvent, "key" | "code">): string {
    const key = event.key.toLowerCase();
    if (key.length === 1 && !/[\x20-\x7e]/.test(key)) {
        const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
        if (letter) return letter.toLowerCase();
    }
    return key;
}

export function comboFromEvent(
    event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">
): string {
    const key = keyName(event);
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

    /** Add a handler. With `replace`, it replaces the handlers already bound to `combo`, like Combokeys. */
    bind(combo: string, handler: KeyHandler, options: { replace?: boolean } = {}): () => void {
        const key = normalizeCombo(combo);
        this.#handlers.set(key, [...(options.replace ? [] : (this.#handlers.get(key) ?? [])), handler]);
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
