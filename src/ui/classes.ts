import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";

/** StyleX props plus a stable class name that user scripts and tests can select. */
export function withClass(name: string, ...styles: readonly (StyleXStyles | false)[]): ReturnType<typeof stylex.props> {
    const props = stylex.props(...styles);
    return { ...props, className: props.className ? `${name} ${props.className}` : name };
}
