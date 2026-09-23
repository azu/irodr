import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { Preferences } from "../app/preferences.ts";
import { useReader, useReaderState } from "./context.tsx";
import { Dialog } from "./Dialog.tsx";
import { colors } from "./tokens.stylex.ts";

const styles = stylex.create({
    form: { display: "grid", gap: 12 },
    field: { display: "grid", gap: 4, fontSize: 14 },
    checkbox: { display: "flex", alignItems: "center", gap: 6, fontSize: 14 },
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

const NUMBER_FIELDS: { name: keyof Preferences; label: string }[] = [
    { name: "autoRefreshSubscriptionSec", label: "Auto Refresh Subscription Seconds" },
    { name: "prefetchSubscriptionCount", label: "Prefetch Subscription Count" },
    { name: "fetchContentsCount", label: "Fetch subscription contents Count" }
];

function PreferencesForm({ preferences }: { preferences: Preferences }) {
    const reader = useReader();
    const [draft, setDraft] = useState<Preferences>(preferences);
    return (
        <form
            {...stylex.props(styles.form)}
            onSubmit={(event) => {
                event.preventDefault();
                reader.updatePreferences(draft);
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
            {NUMBER_FIELDS.map(({ name, label }) => (
                <label key={name} {...stylex.props(styles.field)}>
                    {label}
                    <input
                        type="number"
                        name={name}
                        min={name === "prefetchSubscriptionCount" ? 0 : 1}
                        value={String(draft[name])}
                        onChange={(event) => {
                            const value = event.currentTarget.valueAsNumber;
                            if (!Number.isNaN(value)) setDraft((current) => ({ ...current, [name]: value }));
                        }}
                        {...stylex.props(styles.input)}
                    />
                </label>
            ))}
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
