import * as stylex from "@stylexjs/stylex";
import { colors } from "./tokens.stylex.ts";

const grow = stylex.keyframes({
    from: { transform: "scaleX(0.1)" },
    to: { transform: "scaleX(0.9)" }
});

const styles = stylex.create({
    bar: {
        position: "absolute",
        insetInline: 0,
        top: 0,
        height: 3,
        backgroundColor: colors.separator,
        transformOrigin: "left",
        transform: "scaleX(1)",
        opacity: 0,
        pointerEvents: "none",
        transitionProperty: "opacity",
        transitionDuration: "0.4s",
        zIndex: 1
    },
    loading: {
        opacity: 1,
        transitionDuration: "0s",
        animationName: grow,
        animationDuration: "8s",
        animationTimingFunction: "cubic-bezier(0.1, 0.8, 0.2, 1)",
        animationFillMode: "forwards"
    }
});

/** An indeterminate progress bar: it approaches the end while loading and completes when done. */
export function ProgressBar({ loading }: { loading: boolean }) {
    return (
        <div
            // Decorative: loading is also announced by aria-busy on the feed and the header message.
            aria-hidden="true"
            data-testid="progress-bar"
            data-loading={loading}
            {...stylex.props(styles.bar, loading && styles.loading)}
        />
    );
}
