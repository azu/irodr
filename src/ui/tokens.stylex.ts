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
    categoryHeader: "24px"
});
