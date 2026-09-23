import * as stylex from "@stylexjs/stylex";
import { useEffect, useEffectEvent, useRef } from "react";
import { safeUrl } from "../lib/sanitize.ts";
import { formatDateTime, formatRelative, isoDateTime } from "../lib/time.ts";
import type { Item } from "../sources/source.ts";
import { withClass } from "./classes.ts";
import { useUserScriptEvents } from "./context.tsx";
import { CLASS } from "./dom.ts";
import { HtmlContent } from "./HtmlContent.tsx";
import { useNow } from "./now.ts";
import { colors } from "./tokens.stylex.ts";

const styles = stylex.create({
    article: {
        paddingInline: "1rem",
        borderBottomWidth: 2,
        borderBottomStyle: "solid",
        borderBottomColor: colors.separator,
        borderLeftWidth: 2,
        borderLeftStyle: "solid",
        borderLeftColor: "transparent",
        lineHeight: 1.5,
        scrollMarginTop: 0
    },
    unread: { borderLeftColor: colors.newItem },
    focused: { backgroundColor: colors.focus },
    title: { margin: 0, paddingTop: "0.5em", fontSize: "1.25rem", lineHeight: 1.4 },
    titleLink: { color: colors.link, textDecorationLine: { default: "none", ":hover": "underline" } },
    meta: { color: colors.muted, fontSize: 13 },
    metaLink: { color: colors.muted },
    author: { color: colors.text },
    footer: {
        color: colors.muted,
        fontSize: 13,
        padding: 6,
        borderTopWidth: 1,
        borderTopStyle: "dotted",
        borderTopColor: "#cbcbcb",
        // Some contents float images.
        clear: "both"
    }
});

/** Payload of the `SubscriptionContent::*` user script events (irodr 1.x component props). */
function eventPayload(item: Item, focused: boolean) {
    return {
        contentId: item.id,
        title: item.title,
        url: item.url,
        author: item.author,
        body: item.contentHtml,
        isFocus: focused,
        publishedDate: new Date(item.publishedAt),
        updatedDate: new Date(item.updatedAt)
    };
}

export function Article({ item, focused }: { item: Item; focused: boolean }) {
    const events = useUserScriptEvents();
    const now = useNow();
    const mounted = useRef(false);
    const dispatch = useEffectEvent((name: string) => {
        events?.dispatch(`SubscriptionContent::${name}`, eventPayload(item, focused));
    });
    useEffect(() => {
        dispatch("componentDidMount");
        return () => dispatch("componentWillUnmount");
    }, []);
    // componentDidUpdate: React Compiler re-renders this component only when its inputs change.
    useEffect(() => {
        if (mounted.current) dispatch("componentDidUpdate");
        mounted.current = true;
    });
    const updated = Math.abs(item.updatedAt - item.publishedAt) >= 60_000;
    // Feed data is untrusted: only link to http(s) URLs.
    const href = safeUrl(item.url);
    return (
        <article
            {...withClass(CLASS.item, styles.article, item.unread && styles.unread, focused && styles.focused)}
            data-content-id={item.id}
            data-focused={focused || undefined}
            data-unread={item.unread || undefined}
        >
            <header>
                <h2 {...withClass(CLASS.itemTitle, styles.title)}>
                    <a href={href} target="_blank" rel="noopener" {...stylex.props(styles.titleLink)}>
                        {item.title || "(untitled)"}
                    </a>
                </h2>
                <div {...stylex.props(styles.meta)}>
                    <a href={href} target="_blank" rel="noopener" {...stylex.props(styles.metaLink)}>
                        Original
                    </a>
                    {" | "}
                    <time dateTime={isoDateTime(item.updatedAt)} title={formatDateTime(item.updatedAt)}>
                        {formatRelative(item.updatedAt, now)}
                    </time>
                    {item.author ? (
                        <>
                            {" by "}
                            <span {...stylex.props(styles.author)}>{item.author}</span>
                        </>
                    ) : null}
                </div>
            </header>
            <HtmlContent html={item.contentHtml} className={`${CLASS.itemBody} irodr-article-body`} />
            <footer {...stylex.props(styles.footer)}>
                {"Posted: "}
                <time dateTime={isoDateTime(item.publishedAt)}>{formatDateTime(item.publishedAt)}</time>
                {updated ? (
                    <>
                        {" | Updated: "}
                        <time dateTime={isoDateTime(item.updatedAt)}>{formatDateTime(item.updatedAt)}</time>
                    </>
                ) : null}
            </footer>
        </article>
    );
}
