import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { MIN_AUTO_REFRESH_SEC, type Preferences, type TapControlsSide } from "../app/preferences.ts";
import { useReader, useReaderState } from "./context.tsx";
import { Dialog } from "./Dialog.tsx";
import { colors } from "./tokens.stylex.ts";

const styles = stylex.create({
    form: { display: "grid", gap: 12 },
    field: { display: "grid", gap: 4, fontSize: 14 },
    checkbox: { display: "flex", alignItems: "center", gap: 6, fontSize: 14 },
    description: { marginBlock: 0, fontSize: 13, color: colors.muted },
    input: {
        padding: 6,
        fontSize: 14,
        width: 120,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: colors.border,
        borderRadius: 4
    },
    save: {
        justifySelf: "start",
        paddingBlock: 6,
        paddingInline: 16,
        fontSize: 14,
        borderStyle: "none",
        borderRadius: 4,
        backgroundColor: colors.accent,
        color: colors.accentText,
        cursor: "pointer"
    }
});

type NumberField = "autoRefreshSubscriptionSec" | "prefetchSubscriptionCount" | "fetchContentsCount";

const NUMBER_FIELDS: { name: NumberField; label: string; min: number }[] = [
    { name: "autoRefreshSubscriptionSec", label: "Auto Refresh Subscription Seconds", min: MIN_AUTO_REFRESH_SEC },
    { name: "prefetchSubscriptionCount", label: "Prefetch Subscription Count", min: 0 },
    { name: "fetchContentsCount", label: "Fetch subscription contents Count", min: 1 }
];

/** Number fields stay text while editing, so a field can be cleared before typing a new value. */
type Draft = Pick<Preferences, "enableAutoRefreshSubscription" | "tapControlsSide"> & Record<NumberField, string>;

function toDraft(preferences: Preferences): Draft {
    return {
        enableAutoRefreshSubscription: preferences.enableAutoRefreshSubscription,
        tapControlsSide: preferences.tapControlsSide,
        autoRefreshSubscriptionSec: String(preferences.autoRefreshSubscriptionSec),
        prefetchSubscriptionCount: String(preferences.prefetchSubscriptionCount),
        fetchContentsCount: String(preferences.fetchContentsCount)
    };
}

/** The reader normalizes the result; a field left empty keeps its current value. */
function fromDraft(draft: Draft): Partial<Preferences> {
    const numbers: Partial<Record<NumberField, number>> = {};
    for (const { name } of NUMBER_FIELDS) {
        const value = draft[name].trim();
        if (value !== "") numbers[name] = Number(value);
    }
    return {
        enableAutoRefreshSubscription: draft.enableAutoRefreshSubscription,
        tapControlsSide: draft.tapControlsSide,
        ...numbers
    };
}

function PreferencesForm({ preferences }: { preferences: Preferences }) {
    const reader = useReader();
    const [draft, setDraft] = useState(() => toDraft(preferences));
    return (
        <form
            {...stylex.props(styles.form)}
            onSubmit={(event) => {
                event.preventDefault();
                reader.updatePreferences(fromDraft(draft));
                reader.closePanel();
            }}
        >
            <label {...stylex.props(styles.checkbox)}>
                <input
                    type="checkbox"
                    name="enableAutoRefreshSubscription"
                    checked={draft.enableAutoRefreshSubscription}
                    onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setDraft((current) => ({ ...current, enableAutoRefreshSubscription: checked }));
                    }}
                />
                Enable Auto Refresh Subscription
            </label>
            <p {...stylex.props(styles.description)}>
                Auto refresh pauses when this window is unfocused, the tab is hidden, or there is no activity for 5
                minutes.
            </p>
            {NUMBER_FIELDS.map(({ name, label, min }) => (
                <label key={name} {...stylex.props(styles.field)}>
                    {label}
                    <input
                        type="number"
                        name={name}
                        min={min}
                        value={draft[name]}
                        onChange={(event) => {
                            const value = event.currentTarget.value;
                            setDraft((current) => ({ ...current, [name]: value }));
                        }}
                        {...stylex.props(styles.input)}
                    />
                </label>
            ))}
            <label {...stylex.props(styles.field)}>
                Tap Controls Side
                <select
                    name="tapControlsSide"
                    value={draft.tapControlsSide}
                    onChange={(event) => {
                        const value = event.currentTarget.value as TapControlsSide;
                        setDraft((current) => ({ ...current, tapControlsSide: value }));
                    }}
                    {...stylex.props(styles.input)}
                >
                    <option value="right">Right</option>
                    <option value="left">Left</option>
                </select>
            </label>
            <p {...stylex.props(styles.description)}>
                The k / j / s buttons shown on touch screens. Put them on the left to scroll articles with the right
                hand.
            </p>
            <button type="submit" {...stylex.props(styles.save)}>
                Save
            </button>
        </form>
    );
}

export function PreferencesDialog() {
    const reader = useReader();
    const open = useReaderState((state) => state.panel === "preferences");
    const preferences = useReaderState((state) => state.preferences);
    return (
        <Dialog open={open} title="App Preference" onClose={() => reader.closePanel()}>
            <PreferencesForm preferences={preferences} />
        </Dialog>
    );
}
