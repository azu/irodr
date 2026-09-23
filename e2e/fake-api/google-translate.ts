import { type FakeRequest, type FakeResponse, formBody, json } from "./http.ts";

/**
 * A fake of Google Translate's unofficial `translate_a/single` endpoint, used by
 * resources/userScript/irodr-translate.user.js. It has no documentation; the response shape follows what the
 * endpoint returns for `dt=t`: `[[[translated, original, ...], ...], null, sourceLanguage]`, one segment per line.
 * A translation is the original text prefixed with `[<target language>] `.
 */
export function handleGoogleTranslate(request: FakeRequest, path: string): FakeResponse {
    if (path !== "/translate_a/single") return json({ error: "not found" }, 404);
    const query = request.url.searchParams;
    const text = request.method === "POST" ? (formBody(request).get("q") ?? "") : (query.get("q") ?? "");
    const target = query.get("tl") ?? "";
    const lines = text.split(/(?<=\n)/);
    const segments = lines.map((line) => [line.trim() === "" ? line : `[${target}] ${line}`, line]);
    return json([segments, null, query.get("sl") ?? "en"]);
}
