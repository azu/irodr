/**
 * Translate text in place without rebuilding links. Code stays unchanged, and translated
 * links show their original label in a title tooltip. No second translation is needed.
 */
import { articleScroller } from "./dom.ts";
import { planTranslationBatch } from "./translation-plan.ts";

/** A translated text node: a span holding the original text for restoring. */
const ORIGINAL = "data-original-text";
const SKIPPED = new Set(["PRE", "CODE", "KBD", "SAMP", "VAR"]);
const BLOCKS = "p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, figcaption, dd, dt";
/** Remember absent and empty titles separately, without retaining detached article elements. */
const originalLinkTitles = new WeakMap<Element, string | null>();

const blockOf = (node: Text): Element | null => node.parentElement?.closest(BLOCKS) ?? node.parentElement;

/** Text not translated yet, including link labels; code and translated spans are skipped. */
export function translationNodes(element: Element): Text[] {
    if (SKIPPED.has(element.tagName) || element.hasAttribute(ORIGINAL)) return [];
    return [...element.childNodes].flatMap((child): Text[] => {
        if (child instanceof Text) return child.data.trim() ? [child] : [];
        return child instanceof Element ? translationNodes(child) : [];
    });
}

export function applyText(node: Text, translated: string): void {
    const link = node.parentElement?.closest("a");
    if (link && !originalLinkTitles.has(link)) {
        originalLinkTitles.set(link, link.getAttribute("title"));
        // Capture the whole label before changing its first text, including nested emphasis.
        link.setAttribute("title", link.textContent ?? node.data);
    }
    const span = document.createElement("span");
    span.setAttribute(ORIGINAL, node.data);
    span.textContent = translated;
    node.replaceWith(span);
}

/** Restore the original text without replacing surrounding elements. */
export function restoreOriginals(root: ParentNode): void {
    for (const span of root.querySelectorAll(`[${ORIGINAL}]`)) {
        span.replaceWith(document.createTextNode(span.getAttribute(ORIGINAL) ?? ""));
    }
    for (const link of root.querySelectorAll("a")) {
        if (!originalLinkTitles.has(link)) continue;
        const title = originalLinkTitles.get(link);
        if (title === null) link.removeAttribute("title");
        else if (title !== undefined) link.setAttribute("title", title);
        originalLinkTitles.delete(link);
    }
}

/** Re-measured between batches: scrolling and translated paragraph heights both change priorities. */
export function nextTranslationBatch(body: Element, limit: number): Text[][] {
    if (!body.isConnected) return [];
    const scroller = articleScroller();
    const scrollerRect = scroller?.getBoundingClientRect();
    const view = {
        top: Math.max(0, scrollerRect?.top ?? 0),
        bottom: Math.min(window.innerHeight, scrollerRect?.bottom ?? window.innerHeight)
    };
    if (view.bottom <= view.top) return [];
    const range = document.createRange();
    // Keep inline pieces in one paragraph together, including the labels and surrounding text of links.
    const allNodes = translationNodes(body);
    const blocks = allNodes.map(blockOf);
    const starts = allNodes.flatMap((_node, index) =>
        index === 0 || blocks[index] !== blocks[index - 1] ? [index] : []
    );
    const groups = starts.map((start, index) => allNodes.slice(start, starts[index + 1] ?? allNodes.length));
    const positioned = groups.flatMap((nodes) => {
        const bounds = nodes
            .map((node) => {
                range.selectNodeContents(node);
                return range.getBoundingClientRect();
            })
            .filter((rect) => rect.width > 0 && rect.height > 0);
        return bounds.length > 0
            ? [
                  {
                      value: nodes,
                      top: Math.min(...bounds.map((rect) => rect.top)),
                      bottom: Math.max(...bounds.map((rect) => rect.bottom)),
                      size: nodes.reduce((sum, node) => sum + node.data.length, 0)
                  }
              ]
            : [];
    });
    return planTranslationBatch(positioned, view, limit);
}

/** Keep a visible paragraph anchored when a completed paragraph above it shrinks or expands. */
export function applyVisibleTexts(body: Element, changes: readonly { node: Text; text: string }[]): void {
    const scroller = articleScroller();
    const view = scroller?.getBoundingClientRect();
    const anchor = view
        ? [...body.querySelectorAll(BLOCKS)].find((element) => {
              const rect = element.getBoundingClientRect();
              return rect.bottom > view.top && rect.top < view.bottom;
          })
        : undefined;
    const top = anchor?.getBoundingClientRect().top;
    for (const { node, text } of changes) {
        if (node.isConnected) applyText(node, text);
    }
    if (scroller && anchor && top !== undefined) {
        const shift = anchor.getBoundingClientRect().top - top;
        if (Math.abs(shift) > 1) scroller.scrollTop += shift;
    }
}
