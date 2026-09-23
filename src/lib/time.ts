const pad = (value: number) => String(value).padStart(2, "0");

/** ISO 8601 for `<time dateTime>`, or undefined for an invalid timestamp. */
export function isoDateTime(epochMs: number | undefined): string | undefined {
    return epochMs !== undefined && Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : undefined;
}

/** `YYYY-MM-DD HH:mm:ss` in local time, or "" for an invalid timestamp. */
export function formatDateTime(epochMs: number): string {
    if (!Number.isFinite(epochMs)) return "";
    const date = new Date(epochMs);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
        date.getMinutes()
    )}:${pad(date.getSeconds())}`;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 60 * 60 * 1000],
    ["month", 30 * 24 * 60 * 60 * 1000],
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000]
];

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 hours ago" */
export function formatRelative(epochMs: number, now: number = Date.now()): string {
    if (!Number.isFinite(epochMs)) return "";
    const diff = epochMs - now;
    for (const [unit, size] of UNITS) {
        if (Math.abs(diff) >= size) return relative.format(Math.round(diff / size), unit);
    }
    return "just now";
}
