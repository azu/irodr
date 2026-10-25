import * as stylex from "@stylexjs/stylex";

export const colors = stylex.defineVars({
    text: "#1b1b1b",
    muted: "#747474",
    link: "#00308f",
    /** Article title and "Original" links, as irodr 1.x (Office UI Fabric) drew them. */
    itemLink: "#0078d4",
    /**
     * Feed names in the sidebar. irodr 1.x drew them as Office UI Fabric links (#0078d4); the list is secondary,
     * so it stays lighter than the dark `link` color.
     */
    feedLink: "#0078d4",
    border: "#e5e5e5",
    background: "#ffffff",
    subtle: "#f4f4f4",
    hover: "#e8e8e8",
    accent: "#1f70ff",
    accentText: "#ffffff",
    newItem: "#0078d7",
    focus: "#ffffe0",
    prefetched: "#ffffcc",
    separator: "#a5c5ff",
    danger: "#b3261e"
});

export const sizes = stylex.defineVars({
    header: "40px",
    sidebar: "300px",
    feedRow: "32px",
    /** The sticky category header in the feed list. */
    categoryHeader: "24px",
    /** The control area at the bottom left on touch screens when the tap controls are on the left. */
    leftControlArea: "104px",
    /** The sidebar when the screen is split side by side (media.sideBySide). */
    thinSidebar: "160px",
    /** The sidebar of feed icons only when the screen is split one above the other (media.stacked). */
    iconSidebar: "44px",
    /**
     * The tap controls when the screen is split one above the other: the lower half of the bottom segment, as iPhone
     * Duo folds in the middle. Not `env(viewport-segment-height 0 1)`: Safari 27.1 on the device gave a value far
     * larger than the segment.
     */
    stackedControls: "25dvh"
});

/**
 * Layout breakpoints. The layout follows the viewport width: on iPhone Duo about 466px folded and 626px unfolded in
 * portrait. `sideBySide` and `stacked` add the fold where the browser exposes it (Viewport Segments API; Safari 27.1
 * has it behind the "Viewport Segments API" feature flag).
 */
export const media = stylex.defineConsts({
    /** Phones and iPhone Duo folded: the sidebar becomes a drawer over the articles. */
    narrow: "@media (max-width: 599px)",
    wide: "@media (min-width: 600px)",
    /** Too narrow for the header's button labels and the subscription count. */
    compact: "@media (max-width: 719px)",
    /** Phones 320px wide: the header drops the GitHub link to fit. */
    tiny: "@media (max-width: 359px)",
    /** Touch screens: larger targets and the tap controls. */
    touch: "@media (pointer: coarse)",
    /**
     * Two screen segments side by side, e.g. iPhone Duo partly folded like a book: a thin sidebar, so the articles
     * keep most of the width. Not below 600px, where the sidebar is a drawer.
     * https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/horizontal-viewport-segments
     */
    sideBySide: "@media (horizontal-viewport-segments: 2) and (min-width: 600px)",
    /**
     * Two screen segments one above the other, e.g. iPhone Duo partly folded like a laptop and put on a table: the
     * sidebar shows feed icons only, and the tap controls take the lower half of the bottom segment (ArticleView).
     * Touch screens only, where the tap controls are shown; not below 600px, where the sidebar is a drawer.
     * https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/vertical-viewport-segments
     */
    stacked: "@media (vertical-viewport-segments: 2) and (pointer: coarse) and (min-width: 600px)"
});
