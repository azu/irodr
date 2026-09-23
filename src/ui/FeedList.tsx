import * as stylex from "@stylexjs/stylex";
import { useEffect } from "react";
import type { CategoryView } from "../app/reader.ts";
import { safeUrl } from "../lib/sanitize.ts";
import { type Feed, formatUnreadCount } from "../sources/source.ts";
import { withClass } from "./classes.ts";
import { useReader, useReaderState } from "./context.tsx";
import { CLASS, feedElement } from "./dom.ts";
import { ChevronIcon } from "./icons.tsx";
import { colors, sizes } from "./tokens.stylex.ts";

const TITLE_LIMIT = 40;

const styles = stylex.create({
    nav: {
        overflowY: "auto",
        overflowX: "hidden",
        borderRightWidth: 1,
        borderRightStyle: "solid",
        borderRightColor: colors.border,
        minHeight: 0
    },
    list: { listStyle: "none", margin: 0, padding: 0 },
    categoryButton: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        width: "100%",
        height: 24,
        paddingInline: 6,
        borderStyle: "none",
        backgroundColor: colors.subtle,
        color: colors.text,
        fontSize: 13,
        fontWeight: "bold",
        textAlign: "start",
        cursor: "pointer",
        position: "sticky",
        top: 0,
        zIndex: 1
    },
    feed: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
        minHeight: sizes.feedRow,
        padding: 4,
        paddingInlineStart: 8,
        borderStyle: "none",
        backgroundColor: { default: "transparent", ":hover": colors.hover },
        color: colors.link,
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
    prefetched
}: {
    feed: Feed;
    current: boolean;
    loading: boolean;
    prefetched: boolean;
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
                onClick={() => void reader.openFeed(feed.id)}
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
    prefetched
}: {
    category: CategoryView;
    currentFeedId?: string;
    loadingFeedId?: string;
    prefetched: ReadonlySet<string>;
}) {
    const reader = useReader();
    return (
        <li>
            <button
                type="button"
                {...stylex.props(styles.categoryButton)}
                aria-expanded={!category.collapsed}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => reader.toggleCategory(category.name)}
            >
                <ChevronIcon open={!category.collapsed} size={14} />
                {category.name}
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
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}

export function FeedList() {
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

    return (
        <nav aria-label="Subscriptions" {...withClass("SubscriptionListContainer", styles.nav)}>
            <ul {...stylex.props(styles.list)}>
                {list.categories.map((category) => (
                    <Category
                        key={category.name}
                        category={category}
                        currentFeedId={current}
                        loadingFeedId={list.loadingFeedId}
                        prefetched={list.prefetched}
                    />
                ))}
            </ul>
        </nav>
    );
}
