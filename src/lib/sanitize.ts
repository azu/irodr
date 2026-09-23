/**
 * Allowlist HTML sanitizer for article bodies (browser only).
 *
 * The markup is parsed once in an inert document and the surviving nodes are
 * moved into a fragment. They are never serialized and parsed again, which
 * avoids mutation-XSS through re-parsing.
 */
const ALLOWED_TAGS = new Set([
    "a",
    "b",
    "blockquote",
    "br",
    "caption",
    "code",
    "del",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strike",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul"
]);

// Removed together with their content. Other unknown elements are unwrapped.
const DROPPED_TAGS = new Set([
    "script",
    "style",
    "textarea",
    "option",
    "select",
    "noscript",
    "template",
    "iframe",
    "frame",
    "frameset",
    "object",
    "embed",
    "applet",
    "svg",
    "math",
    "title",
    "head",
    "meta",
    "link",
    "base",
    "form",
    "input",
    "button"
]);

const ALLOWED_ATTRIBUTES: Record<string, readonly string[]> = {
    a: ["href", "name", "title"],
    img: ["src", "width", "height", "alt", "title"]
};

const URL_ATTRIBUTES = new Set(["href", "src"]);

/** Relative, protocol-relative, http and https URLs only. */
export function isSafeUrl(value: string): boolean {
    try {
        // The URL parser strips whitespace and control characters exactly like the browser does.
        const { protocol } = new URL(value, "https://irodr.invalid/");
        return protocol === "http:" || protocol === "https:";
    } catch {
        return false;
    }
}

/** `value` when it is a safe link or image URL, otherwise undefined. */
export function safeUrl(value: string | undefined): string | undefined {
    return value && isSafeUrl(value) ? value : undefined;
}

function cleanChildren(parent: ParentNode, target: ParentNode, doc: Document): void {
    for (const node of parent.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            target.appendChild(doc.createTextNode(node.textContent ?? ""));
            continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = node as Element;
        const tag = element.localName;
        if (DROPPED_TAGS.has(tag)) continue;
        if (!ALLOWED_TAGS.has(tag)) {
            cleanChildren(element, target, doc);
            continue;
        }
        const clean = doc.createElement(tag);
        // Before `src`: an image in the live document starts loading as soon as it has one.
        if (tag === "img") {
            clean.setAttribute("loading", "lazy");
            clean.setAttribute("decoding", "async");
        }
        for (const name of ALLOWED_ATTRIBUTES[tag] ?? []) {
            const value = element.getAttribute(name);
            if (value === null) continue;
            if (URL_ATTRIBUTES.has(name) && !isSafeUrl(value)) continue;
            clean.setAttribute(name, value);
        }
        if (tag === "a") clean.setAttribute("rel", "noopener noreferrer");
        cleanChildren(element, clean, doc);
        target.appendChild(clean);
    }
}

export function sanitizeHtml(html: string, doc: Document = document): DocumentFragment {
    const inert = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
    const fragment = doc.createDocumentFragment();
    cleanChildren(inert.body, fragment, doc);
    return fragment;
}
