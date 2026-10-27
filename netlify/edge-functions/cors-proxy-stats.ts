import { getStore } from "@netlify/blobs";
import { countKeys, STATS_STORE } from "../inoreader-stats.ts";

/**
 * The Inoreader requests of the CORS proxy on one UTC day, per client and endpoint:
 * /cors-proxy-stats?date=2026-10-27 (today when left out).
 */
export default async (req: Request) => {
    const requested = new URL(req.url).searchParams.get("date") ?? "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : new Date().toISOString().slice(0, 10);
    const { blobs } = await getStore(STATS_STORE).list({ prefix: `${date}/` });
    const counts = countKeys(blobs.map((blob) => blob.key));
    return Response.json({ date, total: blobs.length, counts }, { headers: { "Cache-Control": "no-store" } });
};

export const config = { path: "/cors-proxy-stats" };
