import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { Reader, SourceView } from "../app/reader.ts";
import type { SettingAction, SettingField, SourceSettings } from "../sources/source.ts";
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
    fields: { display: "grid", gap: 8 },
    summary: { fontSize: 13, color: colors.link, cursor: "pointer" },
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

/** Every field of the form, including the collapsed ones. */
function allFields(settings: SourceSettings): readonly SettingField[] {
    return [...settings.fields, ...(settings.advanced?.fields ?? [])];
}

function hasValue(field: SettingField): boolean {
    return typeof field.value === "string" ? field.value !== "" : field.value;
}

function SettingInput({
    field,
    value,
    onChange,
    onApply
}: {
    field: SettingField;
    value: string | boolean | undefined;
    onChange: (value: string | boolean) => void;
    /** Runs the field's `setting:<name>` action, for checkboxes with applyOnChange. */
    onApply: (checked: boolean) => void;
}) {
    return field.type === "checkbox" ? (
        <label {...stylex.props(styles.checkbox)}>
            <input
                type="checkbox"
                name={field.name}
                checked={value === true}
                onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    onChange(checked);
                    if (field.applyOnChange) onApply(checked);
                }}
            />
            {field.label}
        </label>
    ) : (
        <label {...stylex.props(styles.field)}>
            {field.label}
            <input
                type={field.type}
                name={field.name}
                autoComplete="off"
                placeholder={field.placeholder}
                value={String(value ?? "")}
                onChange={(event) => onChange(event.currentTarget.value)}
                {...stylex.props(styles.input)}
            />
        </label>
    );
}

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
        // Report this action's failure, not an earlier status such as a failed sync.
        return { ok: false, message: error instanceof Error ? error.message : `${source.title} action failed.` };
    }
}

function SourceSettingsForm({ source }: { source: SourceView }) {
    const reader = useReader();
    const { settings, status, connected } = source.snapshot;
    const fields = allFields(settings);
    const [values, setValues] = useState<Values>(() => initialValues(fields));
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
                outcome.ok ? clearTransient(current, fields) : { ...current, ...revert(overrides, fields) }
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
    const input = (field: SettingField) => (
        <SettingInput
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
            onApply={(checked) => run(`setting:${field.name}`, { [field.name]: checked })}
        />
    );

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
                    {settings.fields.map(input)}
                    {settings.advanced ? (
                        <details open={settings.advanced.fields.some(hasValue)}>
                            <summary {...stylex.props(styles.summary)}>{settings.advanced.summary}</summary>
                            {settings.advanced.description.map((paragraph) => (
                                <p key={paragraph} {...stylex.props(styles.description)}>
                                    {paragraph}
                                </p>
                            ))}
                            <div {...stylex.props(styles.fields)}>{settings.advanced.fields.map(input)}</div>
                        </details>
                    ) : null}
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
