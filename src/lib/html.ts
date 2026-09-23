const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

const NAMED = new Map<string, string>([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
    ["nbsp", " "],
    ["hellip", "…"],
    ["mdash", "—"],
    ["ndash", "–"],
    ["lsquo", "‘"],
    ["rsquo", "’"],
    ["ldquo", "“"],
    ["rdquo", "”"]
]);

function decodeNamed(entity: string): string | undefined {
    const known = NAMED.get(entity);
    if (known !== undefined || typeof DOMParser === "undefined") return known;
    // Resolve the full HTML entity table through an inert document; nothing is loaded or executed.
    const decoded = new DOMParser().parseFromString(`&${entity};`, "text/html").body.textContent ?? "";
    const result = decoded === `&${entity};` ? undefined : decoded;
    NAMED.set(entity, result ?? `&${entity};`);
    return result;
}

/** Decode HTML entities in plain text such as an RSS title. Markup-like text stays as text. */
export function decodeEntities(value: string): string {
    if (!value.includes("&")) return value;
    return value.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]*);/gi, (match, entity: string) => {
        if (entity.startsWith("#")) {
            const hex = entity[1] === "x" || entity[1] === "X";
            const code = hex ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return decodeNamed(entity) ?? match;
    });
}
