import { mergeRuns, type TranslationRun, type TranslationSegment } from "../lib/translation-segment.ts";

/**
 * What translate mode sends from an article body: paragraphs with their inline markup (when the
 * translator keeps markup, see src/lib/translation-segment.ts), or single text nodes otherwise.
 */
export type TranslationUnit =
    | { readonly kind: "text"; readonly node: Text }
    | {
          readonly kind: "block";
          readonly element: Element;
          readonly segment: TranslationSegment;
          /** The inline elements the segment's tags refer to, by tag. */
          readonly inline: readonly Element[];
      };

/** A translated text node: a span holding the original text for restoring. */
const ORIGINAL = "data-original-text";
/** A paragraph whose children were replaced; the original children are in `originals`. */
const TRANSLATED_BLOCK = "data-translated-block";

/** Code and the like stay as they are. */
const SKIPPED = new Set(["PRE", "CODE", "KBD", "SAMP", "VAR"]);
const BLOCKS = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "CAPTION",
    "DD",
    "DETAILS",
    "DIV",
    "DL",
    "DT",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "SUMMARY",
    "TABLE",
    "TBODY",
    "TD",
    "TFOOT",
    "TH",
    "THEAD",
    "TR",
    "UL"
]);
/** Inline elements a paragraph may contain and still be rebuilt from its translation. Images and line breaks are not. */
const INLINE = new Set([
    "A",
    "ABBR",
    "B",
    "BDI",
    "BDO",
    "CITE",
    "CODE",
    "DATA",
    "DEL",
    "DFN",
    "EM",
    "I",
    "INS",
    "KBD",
    "MARK",
    "Q",
    "S",
    "SAMP",
    "SMALL",
    "SPAN",
    "STRONG",
    "SUB",
    "SUP",
    "TIME",
    "U",
    "VAR"
]);

const hasText = (node: Node) => Boolean(node.textContent?.trim());

/** A block with only text and known inline elements, not translated yet. */
function isParagraph(element: Element): boolean {
    return (
        BLOCKS.has(element.tagName) &&
        !SKIPPED.has(element.tagName) &&
        !element.hasAttribute(TRANSLATED_BLOCK) &&
        hasText(element) &&
        [...element.querySelectorAll("*")].every((child) => INLINE.has(child.tagName) && !child.hasAttribute(ORIGINAL))
    );
}

function textNodesOf(element: Element): Text[] {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
        if (walker.currentNode instanceof Text) nodes.push(walker.currentNode);
    }
    return nodes;
}

/** Whether `node` is inside a skipped element (code, ...) below `root`. */
function insideSkipped(node: Node, root: Element): boolean {
    const parent = node.parentElement;
    if (!parent || parent === root) return false;
    return SKIPPED.has(parent.tagName) || insideSkipped(parent, root);
}

function paragraphUnit(element: Element): TranslationUnit {
    const inline = [...element.querySelectorAll("*")];
    const runs = textNodesOf(element).map((node): TranslationRun => {
        const tag = node.parentElement === element || !node.parentElement ? -1 : inline.indexOf(node.parentElement);
        return {
            text: node.data,
            ...(tag === -1 ? {} : { tag }),
            ...(insideSkipped(node, element) ? { skip: true } : {})
        };
    });
    return { kind: "block", element, segment: { runs: mergeRuns(runs) }, inline };
}

/** Text nodes outside paragraphs (or everywhere, without `paragraphs`), skipping code and translated text. */
function collect(element: Element, root: Element, paragraphs: boolean): TranslationUnit[] {
    if (paragraphs && isParagraph(element)) return [paragraphUnit(element)];
    return [...element.childNodes].flatMap((child): TranslationUnit[] => {
        if (child instanceof Text) {
            return hasText(child) && !insideSkipped(child, root) ? [{ kind: "text", node: child }] : [];
        }
        if (!(child instanceof Element)) return [];
        if (SKIPPED.has(child.tagName) || child.hasAttribute(ORIGINAL) || child.hasAttribute(TRANSLATED_BLOCK)) {
            return [];
        }
        return collect(child, root, paragraphs);
    });
}

/** The units of an article body that are not translated yet, in document order. */
export function translationUnits(body: Element, options: { paragraphs: boolean }): TranslationUnit[] {
    return collect(body, body, options.paragraphs);
}

export const unitText = (unit: TranslationUnit): string =>
    unit.kind === "text" ? unit.node.data : unit.segment.runs.map((run) => run.text).join("");

export function applyText(node: Text, translated: string): void {
    const span = document.createElement("span");
    span.setAttribute(ORIGINAL, node.data);
    span.textContent = translated;
    node.replaceWith(span);
}

/** The inline elements from the paragraph down to `element`, outermost first. */
function inlineChain(element: Element, paragraph: Element): Element[] {
    const parent = element.parentElement;
    return !parent || parent === paragraph ? [element] : [...inlineChain(parent, paragraph), element];
}

function runNode(run: TranslationRun, unit: Extract<TranslationUnit, { kind: "block" }>): Node {
    const element = run.tag === undefined ? undefined : unit.inline[run.tag];
    if (!element) return document.createTextNode(run.text);
    // Shallow copies keep attributes such as href; the article HTML was sanitized when rendered.
    return inlineChain(element, unit.element).reduceRight<Node>((child, wrapper) => {
        const copy = wrapper.cloneNode(false);
        copy.appendChild(child);
        return copy;
    }, document.createTextNode(run.text));
}

/**
 * Replaces a paragraph's children with its translation, rebuilding each inline element around the
 * translated words that carry its tag. The original children are kept in `originals` for restoring.
 */
export function applySegment(
    unit: Extract<TranslationUnit, { kind: "block" }>,
    translated: TranslationSegment,
    originals: WeakMap<Element, readonly Node[]>
): void {
    originals.set(unit.element, [...unit.element.childNodes]);
    unit.element.setAttribute(TRANSLATED_BLOCK, "");
    unit.element.replaceChildren(...mergeRuns(translated.runs).map((run) => runNode(run, unit)));
}

/** Puts every translated text and paragraph under `root` back to the original. */
export function restoreOriginals(root: ParentNode, originals: WeakMap<Element, readonly Node[]>): void {
    for (const span of root.querySelectorAll(`[${ORIGINAL}]`)) {
        span.replaceWith(document.createTextNode(span.getAttribute(ORIGINAL) ?? ""));
    }
    for (const element of root.querySelectorAll(`[${TRANSLATED_BLOCK}]`)) {
        const children = originals.get(element);
        if (children) element.replaceChildren(...children);
        element.removeAttribute(TRANSLATED_BLOCK);
    }
}
