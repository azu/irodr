/**
 * DOM lookups shared by the view and keyboard shortcuts.
 * The class names are a public API for user scripts (see docs/userscript.md).
 */
export const CLASS = {
    scroller: "SubscriptionContentsContainer",
    item: "SubscriptionContentsContainer-content",
    itemTitle: "SubscriptionContentsContainer-contentTitle",
    itemBody: "SubscriptionContentsContainer-contentBody",
    feedList: "SubscriptionListContainer",
    feed: "SubscriptionListContainer-item"
} as const;

export function articleScroller(): HTMLElement | null {
    return document.querySelector<HTMLElement>(`.${CLASS.scroller}`);
}

export function itemElement(itemId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`.${CLASS.item}[data-content-id="${CSS.escape(itemId)}"]`);
}

export function feedElement(feedId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`.${CLASS.feed}[data-feedid="${CSS.escape(feedId)}"]`);
}

/**
 * The item the reader is looking at: the first one fully inside the viewport,
 * otherwise the one covering most of it.
 * Based on LDR's reader_main.js (https://gist.github.com/azu/c306c1efa31f0f41aa01c5b69576d00c).
 */
export function activeItemId(scroller: HTMLElement): string | undefined {
    const elements = [...scroller.querySelectorAll<HTMLElement>(`.${CLASS.item}`)];
    if (elements.length === 0) return undefined;
    if (elements.length === 1) return elements[0]?.dataset.contentId;
    const view = scroller.getBoundingClientRect();
    let best: HTMLElement | undefined;
    let bestVisible = 0;
    for (const element of elements) {
        const rect = element.getBoundingClientRect();
        if (rect.bottom <= view.top) continue;
        if (rect.top >= view.bottom) break;
        // Allow sub-pixel rounding at the top edge after scrollIntoView().
        if (rect.top >= view.top - 1 && rect.bottom <= view.bottom + 1) return element.dataset.contentId;
        const visible = Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top);
        if (visible > bestVisible) {
            best = element;
            bestVisible = visible;
        }
    }
    return (best ?? elements.at(-1))?.dataset.contentId;
}

/** Scroll by a share of half the window height, like LDR's space key. */
export function scrollByPage(scroller: HTMLElement, direction: 1 | -1, ratio = 0.3): void {
    scroller.scrollBy(0, (window.innerHeight / 2) * direction * ratio);
}
