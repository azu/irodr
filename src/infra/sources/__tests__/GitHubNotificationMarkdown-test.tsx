import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HTMLContent } from "../../../component/ui-kit/HTMLContent";
import { GitHubNotificationsAdapter } from "../GitHubNotificationsAdapter";

// Exercise the actual display sanitizer, not a mock of HTMLContent. package.json's
// Jest transforms and entities subpath mappings support its ESM parser in Jest 27.
async function renderBody(body: string) {
    const fetchMock = jest.fn();
    for (const value of [
        [
            {
                id: "1",
                subject: { type: "Issue", title: "Issue", url: "https://api.github.com/repos/owner/repo/issues/1" },
                repository: { full_name: "owner/repo" }
            }
        ],
        { body }
    ]) {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            headers: { get: () => null },
            json: async () => value
        });
    }
    const adapter = new GitHubNotificationsAdapter({ fetch: fetchMock });
    const { items } = await adapter.sync({ config: { sourceId: "github", token: "test-token" } });
    const element = document.createElement("div");
    element.innerHTML = renderToStaticMarkup(<HTMLContent className="test">{items[0].content!}</HTMLContent>);
    return element;
}

describe("GitHub notification Markdown display", () => {
    it("renders headings, lists, code, tables, strikethrough and links", async () => {
        const element = await renderBody(
            [
                "# Release",
                "",
                "- **Fixed** a bug",
                "- ~~Removed~~",
                "",
                "```js",
                "<script>example</script>",
                "```",
                "",
                "| Feature | Status |",
                "| --- | --- |",
                "| Markdown | Ready |",
                "",
                "[Docs](https://example.com/docs)",
                "",
                "https://example.com/notes",
                "",
                "![Screenshot](https://example.com/image.png)"
            ].join("\n")
        );
        expect(element.querySelector("h1")?.textContent).toBe("Release");
        expect(element.querySelector("li strong")?.textContent).toBe("Fixed");
        expect(element.querySelector("s")?.textContent).toBe("Removed");
        expect(element.querySelector("pre code")?.textContent).toBe("<script>example</script>\n");
        expect(element.querySelector("td")?.textContent).toBe("Markdown");
        expect(Array.from(element.querySelectorAll("a"), (link) => link.getAttribute("href"))).toEqual([
            "https://example.com/docs",
            "https://example.com/notes"
        ]);
        expect(element.querySelector("img")?.getAttribute("src")).toBe("https://example.com/image.png");
        expect(element.querySelector("script")).toBeNull();
    });

    it.each(["docs/guide.md", "./diagram.png", "../guide.md", "/docs/guide.md", "#section", "//example.com/image.png"])(
        "keeps relative link and image destinations as text: %s",
        async (url) => {
            const body = `[Guide](${url})\n\n![Diagram](${url})`;
            const element = await renderBody(body);
            expect(element.querySelector("a, img")).toBeNull();
            expect(element.textContent).toContain(`[Guide](${url})`);
            expect(element.textContent).toContain(`![Diagram](${url})`);
        }
    );

    it.each(["http", "https"])("preserves explicit %s links, images and automatic links", async (scheme) => {
        const url = `${scheme}://example.com`;
        const element = await renderBody(`[Guide](${url}/guide)\n\n![Diagram](${url}/image.png)\n\n${url}/notes`);
        expect(Array.from(element.querySelectorAll("a"), (link) => link.getAttribute("href"))).toEqual([
            `${url}/guide`,
            `${url}/notes`
        ]);
        expect(element.querySelector("img")?.getAttribute("src")).toBe(`${url}/image.png`);
    });

    it.each([
        '<script>alert(1)</script><img src="x" onerror="alert(1)">',
        '<iframe src="https://example.com"></iframe><svg onload="alert(1)"></svg>',
        '<a href="javascript:alert(1)" onclick="alert(1)">link</a>',
        "[link](javascript:alert%281%29)",
        "[link](JaVaScRiPt:alert%281%29)",
        "[link](jav&#x61;script:alert%281%29)",
        "[link](vbscript:msgbox%281%29)",
        "[link](data:text/html;base64,PHNjcmlwdD4=)",
        "![image](javascript:alert%281%29)",
        "![image](data:image/svg+xml;base64,PHN2Zz4=)",
        "![image](data:image/png;base64,aGVsbG8=)",
        '[link](https://example.com/ "title\\" onclick=\\"alert(1)")'
    ])("does not render executable markup or unsafe URLs: %s", async (body) => {
        const element = await renderBody(body);
        expect(element.querySelector("script, iframe, svg, object, embed, style")).toBeNull();
        for (const node of Array.from(element.querySelectorAll("*"))) {
            for (const attribute of Array.from(node.attributes)) {
                expect(attribute.name).not.toMatch(/^on|^style$/i);
                if (attribute.name === "href" || attribute.name === "src") {
                    expect(attribute.value).toMatch(/^https?:\/\//);
                }
            }
        }
    });

    it("displays plain text and empty bodies without inventing markup", async () => {
        expect((await renderBody("Simple notification")).querySelector("p")?.textContent).toBe("Simple notification");
        expect((await renderBody("")).textContent).toBe("");
    });
});
