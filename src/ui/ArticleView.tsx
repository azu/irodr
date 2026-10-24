import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { ArticleView as View } from "../app/reader.ts";
import { safeUrl } from "../lib/sanitize.ts";
import { formatDateTime, isoDateTime } from "../lib/time.ts";
import { formatUnreadCount } from "../sources/source.ts";
import { Article } from "./Article.tsx";
import { withClass } from "./classes.ts";
import { useReader, useReaderState, useKeyBindings } from "./context.tsx";
import { activeItemId, CLASS, itemElement } from "./dom.ts";
import { ArrowIcon, BookmarkIcon, NextFeedIcon, SettingsIcon } from "./icons.tsx";
import { ProgressBar } from "./ProgressBar.tsx";
import { colors, media, sizes } from "./tokens.stylex.ts";

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
    padding: { height: "100vh" },
    // Touch screens get buttons for k, j and s. Bottom right: in reach of the right thumb, and away from the
    // fold in the middle of iPhone Duo's inner display.
    tapControls: {
        display: { default: "none", [media.touch]: "flex" },
        flexDirection: "column",
        gap: 8,
        // Fixed to a screen corner, also on the left where the sidebar is (preferences: tapControlsSide).
        position: "fixed",
        // Clear of the rounded screen corners of iPad and iPhone Duo. The safe area insets are 0 unless the page
        // uses `viewport-fit=cover`, so the minimums keep the buttons away from the corner without it.
        insetBlockEnd: "max(40px, calc(env(safe-area-inset-bottom) + 16px))",
        zIndex: 1
    },
    tapControlsRight: { insetInlineEnd: "max(20px, calc(env(safe-area-inset-right) + 12px))" },
    // On the left the buttons sit in a row on a solid area, so a tap that misses a button does not open a feed of
    // the sidebar under it. FeedList leaves room for this area below its last feed.
    tapControlsLeft: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        boxSizing: "border-box",
        height: sizes.leftControlArea,
        insetInlineStart: 0,
        insetBlockEnd: 0,
        paddingBlockStart: 12,
        paddingInlineStart: "max(20px, calc(env(safe-area-inset-left) + 12px))",
        paddingInlineEnd: 20,
        borderBlockStartWidth: 1,
        borderBlockStartStyle: "solid",
        borderBlockStartColor: colors.border,
        borderInlineEndWidth: 1,
        borderInlineEndStyle: "solid",
        borderInlineEndColor: colors.border,
        borderStartEndRadius: 12,
        backgroundColor: colors.subtle
    },
    lastInRow: { order: 1 },
    // Feedback while a finger is on a button: `:active` is unreliable on iOS when pointerdown is prevented.
    tapButtonPressed: { backgroundColor: colors.hover, transform: "scale(0.92)" },
    // The focused item is saved for later: a filled, colored button, visible at a glance.
    tapButtonSaved: { backgroundColor: colors.accent, borderColor: colors.accent, color: colors.accentText },
    tapButton: {
        display: "grid",
        placeItems: "center",
        // Apple's minimum hit target: 44 × 44 pt.
        width: 44,
        height: 44,
        padding: 0,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: colors.border,
        borderRadius: 22,
        backgroundColor: "rgb(255 255 255 / 0.85)",
        color: colors.text,
        boxShadow: "0 1px 4px rgb(0 0 0 / 0.15)",
        cursor: "pointer",
        // No double-tap zoom, so repeated taps move on immediately.
        touchAction: "manipulation",
        transitionProperty: "transform, background-color",
        transitionDuration: "80ms"
    }
});

/** How far a touch may move and still be a tap, in CSS pixels. */
const TAP_SLOP = 10;

/**
 * Buttons that press the p, k, j and s keys: they follow keys rebound by user scripts (`registerKey`).
 * `savedForLater` is whether the focused item is saved for later, or undefined when its source cannot save items.
 */
function TapControls({ savedForLater }: { savedForLater?: boolean }) {
    const bindings = useKeyBindings();
    const side = useReaderState((state) => state.preferences.tapControlsSide);
    // The touch that started on a button. A tap ends on the same button near where it started; a swipe moves or is
    // cancelled.
    const press = useRef<{ key: string; pointerId: number; x: number; y: number } | null>(null);
    const [pressedKey, setPressedKey] = useState<string | undefined>(undefined);
    const buttons = [
        // Read later sits away from the corner: first in the column on the right, last in the row on the left, so
        // k, j and s stay where they were.
        ...(savedForLater === undefined
            ? []
            : [{ label: "Read later (p)", key: "p", icon: <BookmarkIcon filled={savedForLater} size={20} /> }]),
        { label: "Previous item (k)", key: "k", icon: <ArrowIcon direction="up" size={22} /> },
        { label: "Next item (j)", key: "j", icon: <ArrowIcon direction="down" size={22} /> },
        { label: "Next feed (s)", key: "s", icon: <NextFeedIcon size={20} /> }
    ];
    return (
        <div
            role="toolbar"
            aria-label="Reading controls"
            data-side={side}
            {...stylex.props(styles.tapControls, side === "left" ? styles.tapControlsLeft : styles.tapControlsRight)}
        >
            {buttons.map((button) => (
                <button
                    key={button.key}
                    type="button"
                    title={button.label}
                    aria-label={button.label}
                    aria-pressed={button.key === "p" ? savedForLater : undefined}
                    {...stylex.props(
                        styles.tapButton,
                        button.key === "p" && side === "left" && styles.lastInRow,
                        button.key === "p" && savedForLater === true && styles.tapButtonSaved,
                        pressedKey === button.key && styles.tapButtonPressed
                    )}
                    // Act on pointer events, not on click: iOS does not fire `click` for a tap that stops a momentum
                    // scroll, so the first tap after a manual scroll did nothing. Act on pointerup, so a swipe that
                    // starts on a button does not open the next feed and mark this one read. Preventing the default
                    // also keeps keyboard focus on the page, as the feed list does.
                    onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        setPressedKey(button.key);
                        press.current = {
                            key: button.key,
                            pointerId: event.pointerId,
                            x: event.clientX,
                            y: event.clientY
                        };
                    }}
                    onPointerUp={(event) => {
                        const start = press.current;
                        press.current = null;
                        setPressedKey(undefined);
                        if (!start || start.key !== button.key || start.pointerId !== event.pointerId) return;
                        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP) return;
                        bindings.trigger(button.key);
                    }}
                    onPointerCancel={() => {
                        press.current = null;
                        setPressedKey(undefined);
                    }}
                    onPointerLeave={() => setPressedKey(undefined)}
                    // Enter or Space on a focused button (`detail` is 0); pointer clicks were handled on pointerup.
                    onClick={(event) => {
                        if (event.detail === 0) bindings.trigger(button.key);
                    }}
                >
                    {button.icon}
                </button>
            ))}
        </div>
    );
}

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
    return view.items.map((item) => (
        <Article
            key={item.id}
            item={item}
            focused={item.id === focusItemId}
            savedForLater={view.canSaveForLater ? view.savedForLater.has(item.id) : undefined}
        />
    ));
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
            <TapControls
                savedForLater={
                    view?.canSaveForLater ? focusItemId !== undefined && view.savedForLater.has(focusItemId) : undefined
                }
            />
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
