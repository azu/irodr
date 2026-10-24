import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { ArticleView } from "./ArticleView.tsx";
import { FeedList } from "./FeedList.tsx";
import { Header } from "./Header.tsx";
import { PreferencesDialog } from "./PreferencesDialog.tsx";
import { SourcesDialog } from "./SourcesDialog.tsx";
import { colors, media, sizes } from "./tokens.stylex.ts";

/** The same width as `media.narrow`, for event handlers. */
const NARROW_QUERY = "(max-width: 599px)";

const styles = stylex.create({
    app: {
        height: "100dvh",
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        // viewport-fit=cover: Safari blurs the page under the status bar most at the top edge. Let the header's
        // top 24px overlap the faint end of that band, so it stays readable without giving up the whole inset,
        // and keep the sidebar out of the notch in landscape.
        paddingBlockStart: "max(0px, calc(env(safe-area-inset-top) - 24px))",
        paddingInlineStart: "env(safe-area-inset-left)",
        paddingInlineEnd: "env(safe-area-inset-right)",
        color: colors.text,
        backgroundColor: colors.background
    },
    body: {
        position: "relative",
        display: "grid",
        // iPhone Duo unfolded (626px) keeps the sidebar, narrower, next to the articles.
        gridTemplateColumns: {
            default: `clamp(200px, 30vw, ${sizes.sidebar}) minmax(0, 1fr)`,
            [media.narrow]: "minmax(0, 1fr)"
        },
        minHeight: 0
    },
    collapsed: { gridTemplateColumns: "minmax(0, 1fr)" },
    backdrop: {
        display: { default: "none", [media.narrow]: "block" },
        position: "absolute",
        insetBlockStart: 0,
        insetBlockEnd: 0,
        insetInlineStart: 0,
        insetInlineEnd: 0,
        zIndex: 2,
        padding: 0,
        borderStyle: "none",
        backgroundColor: "rgb(0 0 0 / 0.3)"
    }
});

/**
 * The sidebar is a column on wide screens and a drawer on narrow ones. Each layout remembers its own state,
 * so folding iPhone Duo does not turn a hidden column into an open drawer.
 */
interface SidebarState {
    readonly collapsed: boolean;
    readonly drawerOpen: boolean;
}

export function App() {
    const [sidebar, setSidebar] = useState<SidebarState>({ collapsed: false, drawerOpen: false });
    const toggleSidebar = () =>
        setSidebar((state) =>
            window.matchMedia(NARROW_QUERY).matches
                ? { ...state, drawerOpen: !state.drawerOpen }
                : { ...state, collapsed: !state.collapsed }
        );
    const closeDrawer = () => setSidebar((state) => ({ ...state, drawerOpen: false }));
    return (
        <div {...stylex.props(styles.app)}>
            <Header onToggleSidebar={toggleSidebar} />
            <div {...stylex.props(styles.body, sidebar.collapsed && styles.collapsed)}>
                <FeedList collapsed={sidebar.collapsed} drawerOpen={sidebar.drawerOpen} onOpenFeed={closeDrawer} />
                {sidebar.drawerOpen ? (
                    <button
                        type="button"
                        aria-label="Close subscriptions"
                        tabIndex={-1}
                        {...stylex.props(styles.backdrop)}
                        onClick={closeDrawer}
                    />
                ) : null}
                <ArticleView />
            </div>
            <SourcesDialog />
            <PreferencesDialog />
        </div>
    );
}
