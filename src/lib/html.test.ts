import { describe, expect, it } from "vite-plus/test";
import { decodeEntities, escapeHtml } from "./html.ts";

describe("html", () => {
    it("escapes text for HTML", () => {
        expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    });

    it("decodes entities in titles without interpreting markup", () => {
        expect(decodeEntities("Tom &amp; Jerry &#8212; &#x1F600; &hellip;")).toBe("Tom & Jerry — 😀 …");
        expect(decodeEntities("a &lt;b&gt; c")).toBe("a <b> c");
        expect(decodeEntities("<b>kept</b> &unknown;")).toBe("<b>kept</b> &unknown;");
    });
});
