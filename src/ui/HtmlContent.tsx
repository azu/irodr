import { useLayoutEffect, useRef } from "react";
import { sanitizeHtml } from "../lib/sanitize.ts";

/**
 * Renders untrusted article HTML. React does not own the children:
 * the sanitized nodes are inserted directly, and user scripts or the
 * translator may rewrite them afterwards.
 */
export function HtmlContent({ html, className }: { html: string; className: string }) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        ref.current?.replaceChildren(sanitizeHtml(html));
    }, [html]);
    return <div ref={ref} className={className} translate="yes" />;
}
