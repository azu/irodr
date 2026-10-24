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
    // Room below the last feed for the tap controls on the left (ArticleView), so every feed can scroll above them.
    leftControlArea: {
        paddingBlockEnd: { default: null, [media.touch]: sizes.leftControlArea },
        scrollPaddingBottom: { default: null, [media.touch]: sizes.leftControlArea }
    },
    list: { listStyle: "none", margin: 0, padding: 0 },
    categoryButton: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        justifyContent: { default: null, [media.stacked]: "center" },
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
        paddingInlineStart: { default: 8, [media.stacked]: 4 },
        // Feed icons only (media.stacked).
        justifyContent: { default: null, [media.stacked]: "center" },
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
    title: { overflowWrap: "anywhere" },
    // Feed icons only (media.stacked): the names stay for screen readers and the `title` tooltip.
    hiddenWhenIconOnly: {
        position: { default: null, [media.stacked]: "absolute" },
        width: { default: null, [media.stacked]: 1 },
        height: { default: null, [media.stacked]: 1 },
        // Also the default of categoryName, which this style follows.
        overflow: "hidden",
        clipPath: { default: null, [media.stacked]: "inset(50%)" },
        whiteSpace: { default: null, [media.stacked]: "nowrap" }
    },
    // The first letter of a feed without an icon, shown in place of the icon. Drawn by CSS, so the feed's text
    // (user scripts and tests read it) stays the title and the count.
    initial: {
        "::before": { content: "attr(data-initial)" },
        display: { default: "none", [media.stacked]: "grid" },
        placeItems: "center",
        flexShrink: 0,
        width: 16,
        height: 16,
        fontSize: 12,
        lineHeight: 1
    }
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
                ) : (
                    <span data-initial={Array.from(feed.title)[0]} {...stylex.props(styles.initial)} />
                )}
                <span {...stylex.props(styles.title, styles.hiddenWhenIconOnly)}>
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
                <span {...stylex.props(styles.categoryName, styles.hiddenWhenIconOnly)}>{category.name}</span>
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
    const controlsOnLeft = useReaderState((state) => state.preferences.tapControlsSide === "left");
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
        <nav
            aria-label="Subscriptions"
            {...withClass(
                CLASS.feedList,
                styles.nav,
                displayStyle(collapsed, drawerOpen),
                controlsOnLeft && styles.leftControlArea
            )}
        >
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
