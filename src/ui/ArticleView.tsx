import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "react";
import type { ArticleView as View } from "../app/reader.ts";
import { safeUrl } from "../lib/sanitize.ts";
import { formatDateTime, isoDateTime } from "../lib/time.ts";
import { formatUnreadCount } from "../sources/source.ts";
import { Article } from "./Article.tsx";
import { withClass } from "./classes.ts";
import { useReader, useReaderState } from "./context.tsx";
import { activeItemId, CLASS, itemElement } from "./dom.ts";
import { SettingsIcon } from "./icons.tsx";
import { ProgressBar } from "./ProgressBar.tsx";
import { colors } from "./tokens.stylex.ts";

const styles = stylex.create({
    main: { position: "relative", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
    scroller: { flexGrow: 1, flexBasis: 0, overflowY: "auto", overflowX: "hidden", outlineStyle: "none" },
    header: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        paddingBlock: 10,
        paddingInline: 16,
        borderBottomWidth: 1,
        borderBottomStyle: "solid",
        borderBottomColor: colors.border
    },
    title: {
        flexGrow: 1,
        flexBasis: 0,
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
        margin: 0,
        fontSize: 16,
        lineHeight: 1.4
    },
    titleLink: { color: colors.link, fontWeight: "bold" },
    icon: { width: 18, height: 18, objectFit: "cover" },
    count: { fontWeight: "normal" },
    editLink: { color: colors.muted, display: "inline-flex" },
    updated: { color: "#999", fontSize: 12, fontWeight: "normal" },
    toggle: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", userSelect: "none" },
    empty: {
        display: "grid",
        placeItems: "center",
        minHeight: "60vh",
        color: colors.muted,
        fontSize: 20,
        margin: 0
    },
    noContents: { fontSize: 48, fontFamily: "Arial, Helvetica, sans-serif" },
    readMore: {
        display: "block",
        width: "100%",
        padding: 8,
        fontSize: 14,
        cursor: "pointer",
        backgroundColor: { default: colors.subtle, ":hover": colors.hover },
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: colors.border
    },
    // Lets the last item scroll to the top of the view.
    padding: { height: "100vh" }
});

function FeedHeader({ view }: { view: View }) {
    const reader = useReader();
    const { feed, capabilities } = view;
    // Loaded items beyond the unread ones, e.g. "(3 + 17)".
    const others = capabilities.unreadFilter ? Math.max(0, view.loadedCount - feed.unreadCount) : 0;
    return (
        <header {...stylex.props(styles.header)}>
            <h2 {...stylex.props(styles.title)}>
                {safeUrl(feed.iconUrl) ? (
                    <img src={safeUrl(feed.iconUrl)} alt="" width={18} height={18} {...stylex.props(styles.icon)} />
                ) : null}
                <a href={safeUrl(feed.htmlUrl)} target="_blank" rel="noopener" {...stylex.props(styles.titleLink)}>
                    {feed.title}
                </a>
                <span data-testid="feed-unread-count" {...stylex.props(styles.count)}>
                    ({formatUnreadCount(feed)}
                    {others > 0 ? ` + ${others}` : ""})
                </span>
                {safeUrl(feed.editUrl) ? (
                    <a
                        href={safeUrl(feed.editUrl)}
                        target="_blank"
                        rel="noopener"
                        title="Edit subscription"
                        aria-label="Edit subscription"
                        {...stylex.props(styles.editLink)}
                    >
                        <SettingsIcon />
                    </a>
                ) : null}
                <span {...stylex.props(styles.updated)}>
                    {"Last updated: "}
                    {feed.updatedAt ? (
                        <time dateTime={isoDateTime(feed.updatedAt)}>{formatDateTime(feed.updatedAt)}</time>
                    ) : (
                        "Not synced yet"
                    )}
                </span>
            </h2>
            {capabilities.unreadFilter ? (
                <label {...stylex.props(styles.toggle)}>
                    <input
                        type="checkbox"
                        checked={view.filterEnabled}
                        onChange={(event) => reader.setFilter(event.currentTarget.checked)}
                        aria-label="Show only unread contents"
                    />
                    {view.filterEnabled ? "Unread" : "All"}
                </label>
            ) : null}
        </header>
    );
}

function Body({ view, focusItemId }: { view: View; focusItemId?: string }) {
    if (!view.loaded) return <p {...stylex.props(styles.empty)}>Loading…</p>;
    if (view.items.length === 0) return <p {...stylex.props(styles.empty)}>No unread items in this feed.</p>;
    return view.items.map((item) => <Article key={item.id} item={item} focused={item.id === focusItemId} />);
}

export function ArticleView() {
    const reader = useReader();
    const view = useReaderState((state) => state.view);
    const focusItemId = useReaderState((state) => state.focusItemId);
    const scrollRequest = useReaderState((state) => state.scrollRequest);
    const loading = useReaderState((state) => state.loading);
    const scroller = useRef<HTMLDivElement>(null);
    const frame = useRef(0);

    const trackFocus = () => {
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
            if (scroller.current) reader.focusItem(activeItemId(scroller.current));
        });
    };

    useEffect(() => {
        if (!scrollRequest) return;
        if (scrollRequest.itemId) itemElement(scrollRequest.itemId)?.scrollIntoView({ block: "start" });
        else scroller.current?.scrollTo(0, 0);
    }, [scrollRequest]);

    const items = view?.items;
    // Items changed (new feed, load more, live update): find the item in view again.
    useEffect(() => {
        const element = scroller.current;
        const id = requestAnimationFrame(() => {
            if (items && element) reader.focusItem(activeItemId(element));
        });
        return () => cancelAnimationFrame(id);
    }, [items, reader]);

    return (
        <main {...stylex.props(styles.main)}>
            <ProgressBar loading={loading} />
            <div
                ref={scroller}
                {...withClass(CLASS.scroller, styles.scroller)}
                onScroll={trackFocus}
                tabIndex={-1}
                data-testid="article-view"
            >
                {view ? (
                    <>
                        <FeedHeader view={view} />
                        <div role="feed" aria-busy={loading} aria-label={view.feed.title}>
                            <Body view={view} focusItemId={focusItemId} />
                        </div>
                        <footer>
                            {view.capabilities.loadMore ? (
                                <button
                                    type="button"
                                    {...stylex.props(styles.readMore)}
                                    onClick={() => void reader.loadMore()}
                                >
                                    Read More
                                </button>
                            ) : null}
                            <div {...stylex.props(styles.padding)} />
                        </footer>
                    </>
                ) : (
                    <p {...stylex.props(styles.empty, styles.noContents)}>No contents</p>
                )}
            </div>
        </main>
    );
}
