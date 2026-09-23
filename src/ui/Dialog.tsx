import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useEffect, useRef } from "react";
import { colors } from "./tokens.stylex.ts";

const styles = stylex.create({
    dialog: {
        width: "min(720px, calc(100vw - 32px))",
        maxHeight: "calc(100vh - 64px)",
        padding: 0,
        borderStyle: "none",
        borderRadius: 8,
        boxShadow: "0 12px 40px rgba(0, 0, 0, 0.25)",
        color: colors.text,
        "::backdrop": { backgroundColor: "rgba(0, 0, 0, 0.3)" }
    },
    header: {
        position: "sticky",
        top: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingBlock: 12,
        paddingInline: 20,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomStyle: "solid",
        borderBottomColor: colors.border
    },
    title: { margin: 0, fontSize: 20 },
    close: { borderStyle: "none", backgroundColor: "transparent", fontSize: 20, cursor: "pointer" },
    body: { paddingBlock: 12, paddingInline: 20 }
});

/** A modal `<dialog>`. Escape and clicks on the backdrop close it. */
export function Dialog({
    open,
    title,
    onClose,
    children
}: {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);
    return (
        // Clicking the backdrop is a mouse shortcut; Escape closes the dialog natively.
        // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
        <dialog
            ref={ref}
            aria-label={title}
            {...stylex.props(styles.dialog)}
            onClose={onClose}
            // Escape: update the state right away instead of waiting for the `close` event.
            onCancel={onClose}
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            {open ? (
                <>
                    <header {...stylex.props(styles.header)}>
                        <h1 {...stylex.props(styles.title)}>{title}</h1>
                        <button type="button" aria-label="Close" {...stylex.props(styles.close)} onClick={onClose}>
                            ×
                        </button>
                    </header>
                    <div {...stylex.props(styles.body)}>{children}</div>
                </>
            ) : null}
        </dialog>
    );
}
