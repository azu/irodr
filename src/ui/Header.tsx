import * as stylex from "@stylexjs/stylex";
import { useReader, useReaderState } from "./context.tsx";
import { GitHubIcon, RefreshIcon, SettingsIcon, SignpostIcon, SourcesIcon } from "./icons.tsx";
import { colors, sizes } from "./tokens.stylex.ts";

const styles = stylex.create({
    header: {
        height: sizes.header,
        display: "flex",
        alignItems: "center",
        gap: 12,
        paddingInline: 12,
        borderBottomWidth: 1,
        borderBottomStyle: "solid",
        borderBottomColor: colors.border,
        backgroundColor: colors.background,
        overflow: "hidden",
        whiteSpace: "nowrap"
    },
    logo: { display: "flex", alignItems: "center", margin: 0, fontSize: 22, fontWeight: "bold" },
    button: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 28,
        paddingInline: 8,
        borderStyle: "none",
        borderRadius: 4,
        backgroundColor: { default: "transparent", ":hover": colors.hover },
        color: colors.text,
        fontSize: 14,
        cursor: "pointer"
    },
    message: {
        flexGrow: 1,
        flexBasis: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontSize: 14
    },
    stat: { fontSize: 14 },
    link: { display: "inline-flex", color: colors.text }
});

export function Header() {
    const reader = useReader();
    const message = useReaderState((state) => state.message);
    const totals = useReaderState((state) => state.totals);
    return (
        <header {...stylex.props(styles.header)}>
            <h1 {...stylex.props(styles.logo)} title="Irodr">
                <img src="/favicon.png" alt="I" width={20} height={20} />
                rodr
            </h1>
            <button type="button" {...stylex.props(styles.button)} onClick={() => void reader.refresh()}>
                <RefreshIcon /> Refresh
            </button>
            <button type="button" {...stylex.props(styles.button)} onClick={() => reader.openPanel("sources")}>
                <SourcesIcon /> Sources
            </button>
            <output aria-live="polite" data-testid="header-message" {...stylex.props(styles.message)}>
                {message.icon === "end" ? <SignpostIcon /> : null}
                {message.text}
            </output>
            <span data-testid="total-unread" {...stylex.props(styles.stat)}>
                Unread: {totals.unread}
            </span>
            <span data-testid="total-feeds" {...stylex.props(styles.stat)}>
                Subscriptions: {totals.feeds}
            </span>
            <button
                type="button"
                title="Preferences"
                aria-label="Preferences"
                {...stylex.props(styles.button)}
                onClick={() => reader.openPanel("preferences")}
            >
                <SettingsIcon />
            </button>
            <a
                href="https://github.com/azu/irodr"
                title="Irodr on GitHub"
                aria-label="Irodr on GitHub"
                {...stylex.props(styles.link)}
            >
                <GitHubIcon />
            </a>
        </header>
    );
}
