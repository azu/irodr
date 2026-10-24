import * as stylex from "@stylexjs/stylex";
import { useReader, useReaderState } from "./context.tsx";
import { GitHubIcon, RefreshIcon, SettingsIcon, SidebarIcon, SignpostIcon, SourcesIcon } from "./icons.tsx";
import { colors, media, sizes } from "./tokens.stylex.ts";

const styles = stylex.create({
    header: {
        height: sizes.header,
        display: "flex",
        alignItems: "center",
        gap: { default: 12, [media.compact]: 8 },
        paddingInline: { default: 12, [media.compact]: 8 },
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
        flexShrink: 0,
        height: { default: 28, [media.touch]: 36 },
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
        // Centered text is cut on both sides when it does not fit; keep its start visible on narrow screens.
        justifyContent: { default: "center", [media.compact]: "flex-start" },
        gap: 4,
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontSize: 14
    },
    stat: { fontSize: 14 },
    // On iPhone Duo folded and other phones, the header keeps the icons and the unread count.
    wideOnly: { display: { default: null, [media.compact]: "none" } },
    link: { display: { default: "inline-flex", [media.tiny]: "none" }, color: colors.text }
});

export function Header({ onToggleSidebar }: { onToggleSidebar: () => void }) {
    const reader = useReader();
    const message = useReaderState((state) => state.message);
    const totals = useReaderState((state) => state.totals);
    return (
        <header {...stylex.props(styles.header)}>
            <button
                type="button"
                title="Toggle subscriptions"
                aria-label="Toggle subscriptions"
                {...stylex.props(styles.button)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onToggleSidebar}
            >
                <SidebarIcon />
            </button>
            <h1 {...stylex.props(styles.logo)} title="Irodr">
                <img src="/favicon.png" alt="I" width={20} height={20} />
                rodr
            </h1>
            <button
                type="button"
                aria-label="Refresh"
                {...stylex.props(styles.button)}
                onClick={() => void reader.refresh()}
            >
                <RefreshIcon /> <span {...stylex.props(styles.wideOnly)}>Refresh</span>
            </button>
            <button
                type="button"
                aria-label="Sources"
                {...stylex.props(styles.button)}
                onClick={() => reader.openPanel("sources")}
            >
                <SourcesIcon /> <span {...stylex.props(styles.wideOnly)}>Sources</span>
            </button>
            <output aria-live="polite" data-testid="header-message" {...stylex.props(styles.message)}>
                {message.icon === "end" ? <SignpostIcon /> : null}
                {message.text}
            </output>
            <span data-testid="total-unread" {...stylex.props(styles.stat)}>
                Unread: {totals.unread}
            </span>
            <span data-testid="total-feeds" {...stylex.props(styles.stat, styles.wideOnly)}>
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
