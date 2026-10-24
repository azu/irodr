import * as stylex from "@stylexjs/stylex";
import { useEffect } from "react";
import type { CategoryView } from "../app/reader.ts";
import { safeUrl } from "../lib/sanitize.ts";
import { type Feed, formatUnreadCount } from "../sources/source.ts";
import { withClass } from "./classes.ts";
import { useReader, useReaderState } from "./context.tsx";
import { CLASS, feedElement } from "./dom.ts";
import { ChevronIcon } from "./icons.tsx";
import { colors, media, sizes } from "./tokens.stylex.ts";

const TITLE_LIMIT = 40;

const styles = stylex.create({
    nav: {
        overflowY: "auto",
        overflowX: "hidden",
        borderRightWidth: 1,
        borderRightStyle: "solid",
        borderRightColor: colors.border,
        minHeight: 0,
        // Feeds scrolled into view must stay clear of the sticky category header.
        scrollPaddingTop: sizes.categoryHeader,
        backgroundColor: colors.background,
        // A drawer over the articles on narrow screens.
        position: { default: null, [media.narrow]: "absolute" },
        insetBlockStart: { default: null, [media.narrow]: 0 },
        insetBlockEnd: { default: null, [media.narrow]: 0 },
        insetInlineStart: { default: null, [media.narrow]: 0 },
        zIndex: { default: null, [media.narrow]: 3 },
        width: { default: null, [media.narrow]: "min(85vw, 320px)" },
        boxShadow: { default: null, [media.narrow]: "2px 0 8px rgb(0 0 0 / 0.2)" }
    },
    // `display` for each pair of (column collapsed, drawer open). One style per pair, because StyleX replaces
    // a property's media queries as a whole.
    shown: { display: { default: "block", [media.narrow]: "none" } },
    shownWithDrawer: { display: "block" },
    hidden: { display: "none" },
    hiddenWithDrawer: { display: { default: "none", [media.narrow]: "block" } },
    list: { listStyle: "none", margin: 0, padding: 0 },
    categoryButton: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        width: "100%",
        height: sizes.categoryHeader,
        paddingInline: 6,
        borderStyle: "none",
        backgroundColor: colors.subtle,
        color: colors.text,
        fontSize: 13,
        // Regular weight as in irodr 1.x, so the sidebar does not draw the eye away from the articles.
        fontWeight: "normal",
        textAlign: "start",
        cursor: "pointer",
        position: "sticky",
        top: 0,
        zIndex: 1,
        // One line, so the header is exactly sizes.categoryHeader tall (the list's scroll padding).
        overflow: "hidden",
        whiteSpace: "nowrap"
    },
    categoryName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
    feed: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
        minHeight: { default: sizes.feedRow, [media.touch]: 40 },
        padding: 4,
        paddingInlineStart: 8,
        borderStyle: "none",
        backgroundColor: { default: "transparent", ":hover": colors.hover },
        color: colors.feedLink,
        fontSize: 14,
        textAlign: "start",
        cursor: "pointer"
    },
    read: { opacity: 0.5 },
    prefetched: { backgroundColor: { default: colors.prefetched, ":hover": colors.hover } },
    loading: {
        outlineWidth: 2,
        outlineStyle: "dashed",
        outlineColor: colors.accent,
        outlineOffset: -2
    },
    current: {
        backgroundColor: { default: colors.accent, ":hover": colors.accent },
        color: colors.accentText,
        fontWeight: "bold",
        opacity: 1
    },
    icon: { flexShrink: 0, width: 16, height: 16 },
    title: { overflowWrap: "anywhere" }
});

function FeedRow({
    feed,
    current,
    loading,
    prefetched,
    onOpenFeed
}: {
    feed: Feed;
    current: boolean;
    loading: boolean;
    prefetched: boolean;
    onOpenFeed: () => void;
}) {
    const reader = useReader();
    const title = feed.title.length > TITLE_LIMIT ? `${feed.title.slice(0, TITLE_LIMIT)}…` : feed.title;
    return (
        <li>
            <button
                type="button"
                {...withClass(
                    CLASS.feed,
                    styles.feed,
                    feed.unreadCount === 0 && styles.read,
                    prefetched && feed.unreadCount > 0 && styles.prefetched,
                    current && styles.current,
                    loading && styles.loading
                )}
                data-feedid={feed.id}
                data-loading={loading || undefined}
                aria-current={current || undefined}
                title={feed.title}
                tabIndex={-1}
                // Keep keyboard focus on the page so shortcuts keep working after a click.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                    onOpenFeed();
                    void reader.openFeed(feed.id);
                }}
            >
                {safeUrl(feed.iconUrl) ? (
                    <img
                        src={safeUrl(feed.iconUrl)}
                        alt=""
                        width={16}
                        height={16}
                        loading="lazy"
                        {...stylex.props(styles.icon)}
                    />
                ) : null}
                <span {...stylex.props(styles.title)}>
                    {title} ({formatUnreadCount(feed)})
                </span>
            </button>
        </li>
    );
}

function Category({
    category,
    currentFeedId,
    loadingFeedId,
    prefetched,
    onOpenFeed
}: {
    category: CategoryView;
    currentFeedId?: string;
    loadingFeedId?: string;
    prefetched: ReadonlySet<string>;
    onOpenFeed: () => void;
}) {
    const reader = useReader();
    return (
        <li>
            <button
                type="button"
                {...stylex.props(styles.categoryButton)}
                aria-expanded={!category.collapsed}
                title={category.name}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => reader.toggleCategory(category.name)}
            >
                <ChevronIcon open={!category.collapsed} size={14} />
                <span {...stylex.props(styles.categoryName)}>{category.name}</span>
            </button>
            {category.collapsed ? null : (
                <ul {...stylex.props(styles.list)} aria-label={category.name}>
                    {category.feeds.map((feed) => (
                        <FeedRow
                            key={feed.id}
                            feed={feed}
                            current={feed.id === currentFeedId}
                            loading={feed.id === loadingFeedId}
                            prefetched={prefetched.has(feed.id)}
                            onOpenFeed={onOpenFeed}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}

function displayStyle(collapsed: boolean, drawerOpen: boolean) {
    if (collapsed) return drawerOpen ? styles.hiddenWithDrawer : styles.hidden;
    return drawerOpen ? styles.shownWithDrawer : styles.shown;
}

export function FeedList({
    collapsed,
    drawerOpen,
    onOpenFeed
}: {
    /** The column is hidden on wide screens. */
    collapsed: boolean;
    /** The drawer is open on narrow screens. */
    drawerOpen: boolean;
    /** A feed was opened from the list. */
    onOpenFeed: () => void;
}) {
    const list = useReaderState((state) => state.list);
    const current = list.currentFeedId;
    const index = current ? list.navigation.indexOf(current) : -1;

    // Bring the current feed to the top when navigating.
    useEffect(() => {
        if (current) feedElement(current)?.scrollIntoView({ block: "start" });
    }, [current]);
    // Read feeds above it can leave the list and shift it out of view: keep it visible.
    useEffect(() => {
        if (current && index !== -1) feedElement(current)?.scrollIntoView({ block: "nearest" });
    }, [current, index]);
    // A hidden list cannot scroll: show the current feed when the drawer opens.
    useEffect(() => {
        if (drawerOpen && current) feedElement(current)?.scrollIntoView({ block: "nearest" });
    }, [drawerOpen, current]);

    return (
        <nav aria-label="Subscriptions" {...withClass(CLASS.feedList, styles.nav, displayStyle(collapsed, drawerOpen))}>
            <ul {...stylex.props(styles.list)}>
                {list.categories.map((category) => (
                    <Category
                        key={category.name}
                        category={category}
                        currentFeedId={current}
                        loadingFeedId={list.loadingFeedId}
                        prefetched={list.prefetched}
                        onOpenFeed={onOpenFeed}
                    />
                ))}
            </ul>
        </nav>
    );
}
