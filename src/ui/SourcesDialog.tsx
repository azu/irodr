import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { Reader, SourceView } from "../app/reader.ts";
import type { SettingAction, SettingField } from "../sources/source.ts";
import { useReader, useReaderState } from "./context.tsx";
import { Dialog } from "./Dialog.tsx";
import { colors } from "./tokens.stylex.ts";

const styles = stylex.create({
    section: { paddingBlock: 8, borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: colors.border },
    heading: { display: "flex", alignItems: "baseline", gap: 12, margin: 0, fontSize: 18 },
    homeLink: { fontSize: 13, fontWeight: "normal", color: colors.link },
    status: { display: "block", marginBlock: 8, fontSize: 13, color: colors.muted },
    connected: { color: "#1a7f37", fontWeight: "bold" },
    description: { fontSize: 13, lineHeight: 1.5, color: colors.text },
    fieldset: { display: "grid", gap: 8, borderStyle: "none", margin: 0, padding: 0 },
    field: { display: "grid", gap: 4, fontSize: 13 },
    checkbox: { display: "flex", alignItems: "center", gap: 6, fontSize: 13 },
    input: {
        padding: 6,
        fontSize: 14,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: colors.border,
        borderRadius: 4
    },
    actions: { display: "flex", gap: 8, flexWrap: "wrap" },
    button: {
        paddingBlock: 6,
        paddingInline: 12,
        fontSize: 14,
        borderRadius: 4,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: colors.border,
        backgroundColor: colors.subtle,
        cursor: { default: "pointer", ":disabled": "not-allowed" }
    },
    primary: { backgroundColor: colors.accent, borderColor: colors.accent, color: colors.accentText },
    result: { display: "block", minHeight: "1.5em", marginBlock: 8, fontSize: 13 },
    footer: { display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 13, color: colors.muted }
});

type Values = Record<string, string | boolean>;

function initialValues(fields: readonly SettingField[]): Values {
    return Object.fromEntries(fields.map((field) => [field.name, field.value]));
}

function revert(changed: Values, fields: readonly SettingField[]): Values {
    return Object.fromEntries(
        Object.keys(changed).map((name) => [name, fields.find((field) => field.name === name)?.value ?? ""])
    );
}

function clearTransient(values: Values, fields: readonly SettingField[]): Values {
    return Object.fromEntries(
        Object.entries(values).map(([name, value]) => [
            name,
            fields.find((field) => field.name === name)?.transient ? "" : value
        ])
    );
}

async function runAction(
    reader: Reader,
    source: SourceView,
    actionId: string,
    values: Values
): Promise<{ ok: boolean; message: string }> {
    try {
        return { ok: true, message: await reader.runSourceAction(source.id, actionId, values) };
    } catch (error) {
        const status = reader.getState().sources.find((view) => view.id === source.id)?.snapshot.status;
        return {
            ok: false,
            message:
                status?.phase === "error"
                    ? status.message
                    : error instanceof Error
                      ? error.message
                      : `${source.title} action failed.`
        };
    }
}

function SourceSettingsForm({ source }: { source: SourceView }) {
    const reader = useReader();
    const { settings, status, connected } = source.snapshot;
    const [values, setValues] = useState<Values>(() => initialValues(settings.fields));
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState("");

    const run = (actionId: string, overrides: Values = {}) => {
        if (busy) return;
        setBusy(true);
        setResult("");
        void runAction(reader, source, actionId, { ...values, ...overrides }).then((outcome) => {
            setResult(outcome.message);
            // Never keep secrets in component state after use; undo optimistic changes on failure.
            setValues((current) =>
                outcome.ok
                    ? clearTransient(current, settings.fields)
                    : { ...current, ...revert(overrides, settings.fields) }
            );
            setBusy(false);
        });
    };

    const primary = settings.actions.find((action) => action.primary);
    const ready = (action: SettingAction) =>
        (action.requires ?? []).every((name) => {
            const value = values[name];
            return typeof value === "string" ? value.trim() !== "" : Boolean(value);
        });

    return (
        <section aria-labelledby={`source-${source.id}`} {...stylex.props(styles.section)}>
            <h2 id={`source-${source.id}`} {...stylex.props(styles.heading)}>
                {source.title}
                {source.homeUrl ? (
                    <a href={source.homeUrl} target="_blank" rel="noopener" {...stylex.props(styles.homeLink)}>
                        Open {source.title} ↗
                    </a>
                ) : null}
            </h2>
            <output {...stylex.props(styles.status)} data-testid={`source-status-${source.id}`}>
                <span {...stylex.props(connected && styles.connected)}>
                    {connected ? "Connected" : "Not connected"}
                </span>
                {status.message ? ` — ${status.message}` : ""}
            </output>
            {settings.description.map((paragraph) => (
                <p key={paragraph} {...stylex.props(styles.description)}>
                    {paragraph}
                </p>
            ))}
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    if (primary && ready(primary)) run(primary.id);
                }}
            >
                <fieldset disabled={busy} {...stylex.props(styles.fieldset)}>
                    {settings.fields.map((field) =>
                        field.type === "checkbox" ? (
                            <label key={field.name} {...stylex.props(styles.checkbox)}>
                                <input
                                    type="checkbox"
                                    name={field.name}
                                    checked={values[field.name] === true}
                                    onChange={(event) => {
                                        const checked = event.currentTarget.checked;
                                        setValues((current) => ({ ...current, [field.name]: checked }));
                                        if (field.applyOnChange)
                                            run(`setting:${field.name}`, { [field.name]: checked });
                                    }}
                                />
                                {field.label}
                            </label>
                        ) : (
                            <label key={field.name} {...stylex.props(styles.field)}>
                                {field.label}
                                <input
                                    type={field.type}
                                    name={field.name}
                                    autoComplete="off"
                                    placeholder={field.placeholder}
                                    value={String(values[field.name] ?? "")}
                                    onChange={(event) => {
                                        const value = event.currentTarget.value;
                                        setValues((current) => ({ ...current, [field.name]: value }));
                                    }}
                                    {...stylex.props(styles.input)}
                                />
                            </label>
                        )
                    )}
                    <div {...stylex.props(styles.actions)}>
                        {settings.actions.map((action) => (
                            <button
                                key={action.id}
                                type={action.primary ? "submit" : "button"}
                                disabled={!ready(action)}
                                onClick={action.primary ? undefined : () => run(action.id)}
                                {...stylex.props(styles.button, action.primary && styles.primary)}
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>
                </fieldset>
            </form>
            <output aria-live="polite" {...stylex.props(styles.result)} data-testid={`source-result-${source.id}`}>
                {busy ? "Working…" : result}
            </output>
        </section>
    );
}

export function SourcesDialog() {
    const reader = useReader();
    const open = useReaderState((state) => state.panel === "sources");
    const sources = useReaderState((state) => state.sources);
    return (
        <Dialog open={open} title="Sources" onClose={() => reader.closePanel()}>
            {sources.map((source) => (
                <SourceSettingsForm key={source.id} source={source} />
            ))}
            <footer {...stylex.props(styles.footer)}>
                <span>This site is powered by Netlify.</span>
                <a href="https://www.netlify.com" target="_blank" rel="noopener">
                    <img
                        src="https://www.netlify.com/img/global/badges/netlify-color-bg.svg"
                        alt="Netlify"
                        height={32}
                    />
                </a>
            </footer>
        </Dialog>
    );
}
