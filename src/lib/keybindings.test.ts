import { describe, expect, it } from "vite-plus/test";
import { comboFromEvent, KeyBindings, normalizeCombo } from "./keybindings.ts";

const key = (
    value: string,
    modifiers: Partial<Record<"ctrlKey" | "altKey" | "metaKey" | "shiftKey", boolean>> = {},
    code = ""
) => ({
    key: value,
    code,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers
});

describe("key bindings", () => {
    it("normalizes combos", () => {
        expect(normalizeCombo("Shift+J")).toBe("shift+j");
        expect(normalizeCombo("shift + space")).toBe("shift+space");
        expect(normalizeCombo("meta+shift+s")).toBe("meta+shift+s");
    });

    it("reads combos from keyboard events", () => {
        expect(comboFromEvent(key("j"))).toBe("j");
        expect(comboFromEvent(key("J", { shiftKey: true }))).toBe("shift+j");
        expect(comboFromEvent(key(" "))).toBe("space");
        expect(comboFromEvent(key(" ", { shiftKey: true }))).toBe("shift+space");
        // Browser shortcuts such as Cmd+S are not reader shortcuts.
        expect(comboFromEvent(key("s", { metaKey: true }))).toBe("meta+s");
    });

    it("uses the physical key on non-Latin keyboard layouts", () => {
        expect(comboFromEvent(key("о", {}, "KeyJ"))).toBe("j");
        expect(comboFromEvent(key("Ы", { shiftKey: true }, "KeyS"))).toBe("shift+s");
    });

    it("binds, triggers and unbinds handlers", () => {
        const bindings = new KeyBindings();
        const calls: string[] = [];
        const unbind = bindings.bind("Shift+S", () => calls.push("skip"));
        bindings.bind("s", () => calls.push("next"));
        const event = {} as KeyboardEvent;
        expect(bindings.trigger("shift+s", event)).toBe(true);
        expect(bindings.trigger("s", event)).toBe(true);
        unbind();
        expect(bindings.trigger("shift+s", event)).toBe(false);
        expect(calls).toEqual(["skip", "next"]);
    });

    it("replaces existing handlers when asked, like Combokeys", () => {
        const bindings = new KeyBindings();
        const calls: string[] = [];
        bindings.bind("v", () => calls.push("default"));
        bindings.bind("v", () => calls.push("user script"), { replace: true });
        bindings.trigger("v", {} as KeyboardEvent);
        expect(calls).toEqual(["user script"]);
    });
});
