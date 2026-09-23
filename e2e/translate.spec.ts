import type { Page } from "@playwright/test";
import { inoreaderSubscriptions } from "./fake-api/fixtures.ts";
import { closeDialog, connectInoreader, expect, focusedArticle, headerMessage, requests, test } from "./fixtures.ts";

const ALPHA = "feed/https://alpha.example.com/rss";
/** A paragraph with nested inline markup, and code that stays as it is. */
const MARKUP_HTML =
    '<p>Read <a href="https://example.com/docs">the <strong>docs</strong></a> now.</p><pre><code>npm install</code></pre>';
/** 12 paragraphs of 200 characters: translated in parts of up to 1000 characters. */
const LONG_PARAGRAPHS = Array.from({ length: 12 }, (_, index) =>
    `Paragraph ${String(index + 1).padStart(2, "0")} `.padEnd(200, "x")
);
const CONTENTS = [undefined, MARKUP_HTML, LONG_PARAGRAPHS.map((text) => `<p>${text}</p>`).join("")];

test.beforeEach(async ({ api, page }) => {
    const subscriptions = inoreaderSubscriptions().map((subscription) =>
        subscription.id === ALPHA
            ? {
                  ...subscription,
                  items: subscription.items.map((item, index) => ({
                      ...item,
                      content: CONTENTS[index] ?? item.content
                  }))
              }
            : subscription
    );
    await api.reset({ inoreader: { subscriptions } });
    await connectInoreader(page);
    await closeDialog(page);
    await page.keyboard.press("s");
    await page.keyboard.press("j");
    await expect(focusedArticle(page)).toContainText("alpha article 1");
});

function body(page: Page) {
    return focusedArticle(page).locator(".SubscriptionContentsContainer-contentBody");
}

/** `j` focuses the first article again while the list is scrolled to the top. */
async function moveTo(page: Page, title: string): Promise<void> {
    await expect(async () => {
        await page.keyboard.press("j");
        await expect(focusedArticle(page)).toContainText(title, { timeout: 500 });
    }).toPass();
}

async function translateRequests(api: import("./fixtures.ts").FakeApi) {
    return requests(await api.log(), "local", "/api/translate").map((entry) => JSON.parse(entry.body) as unknown);
}

test("Shift+T translates with the local server and restores the original", async ({ page, api }) => {
    await expect(body(page)).toHaveText("Body of alpha article 1.");
    await page.keyboard.press("Shift+T");
    await expect(headerMessage(page)).toHaveText("Translate mode: ON");
    await expect(body(page)).toHaveText("[ja] Body of alpha article 1.");

    await page.keyboard.press("Shift+T");
    await expect(headerMessage(page)).toHaveText("Translate mode: OFF");
    await expect(body(page)).toHaveText("Body of alpha article 1.");

    expect(await translateRequests(api)).toEqual([
        {
            segments: [{ runs: [{ text: "Body of alpha article 1." }] }],
            sourceLanguage: "en",
            targetLanguage: "ja"
        }
    ]);
});

test("translates a paragraph as one sentence and rebuilds its markup", async ({ page, api }) => {
    await page.keyboard.press("Shift+T");
    await expect(body(page)).toHaveText("[ja] Body of alpha article 1.");
    await moveTo(page, "alpha article 2");

    // The fake translator reverses the runs, as a change of word order would.
    const paragraph = body(page).locator("p");
    await expect(paragraph).toHaveText("[ja]  now.docsthe Read ");
    await expect(paragraph.locator("a")).toHaveText(["docs", "the "]);
    await expect(paragraph.locator('a[href="https://example.com/docs"] > strong')).toHaveText("docs");
    await expect(body(page).locator("pre")).toHaveText("npm install");
    expect((await translateRequests(api)).at(-1)).toEqual({
        segments: [
            {
                runs: [{ text: "Read " }, { text: "the ", tag: 0 }, { text: "docs", tag: 1 }, { text: " now." }]
            }
        ],
        sourceLanguage: "en",
        targetLanguage: "ja"
    });

    await page.keyboard.press("Shift+T");
    await expect(paragraph).toHaveText("Read the docs now.");
    await expect(paragraph.locator("a")).toHaveText(["the docs"]);
    await expect(paragraph.locator("a > strong")).toHaveText("docs");
});

test("translates text by text when the server cannot keep markup", async ({ page, api }) => {
    await api.control("POST", "/local/config", { segments: false });
    await page.keyboard.press("Shift+T");
    await expect(body(page)).toHaveText("[ja] Body of alpha article 1.");
    await moveTo(page, "alpha article 2");
    await expect(body(page).locator("p")).toHaveText("[ja] Read [ja] the [ja] docs[ja]  now.");
    expect((await translateRequests(api)).at(-1)).toEqual({
        texts: ["Read ", "the ", "docs", " now."],
        sourceLanguage: "en",
        targetLanguage: "ja"
    });
});

test("shows the local server's error", async ({ page, api }) => {
    await api.control("POST", "/local/config", { translateError: "language package is not installed: en -> ja" });
    await page.keyboard.press("Shift+T");
    await expect(headerMessage(page)).toHaveText("language package is not installed: en -> ja");
    await expect(body(page)).toHaveText("Body of alpha article 1.");
});

test("translates a long article in parts", async ({ page, api }) => {
    await page.keyboard.press("Shift+T");
    await expect(body(page)).toHaveText("[ja] Body of alpha article 1.");
    await moveTo(page, "alpha article 3");
    await expect(body(page).locator("p")).toHaveText(LONG_PARAGRAPHS.map((text) => `[ja] ${text}`));

    const parts = (await translateRequests(api))
        .map((request) => request as { segments: { runs: { text: string }[] }[] })
        .filter((request) => request.segments.some((segment) => segment.runs[0]?.text.startsWith("Paragraph")));
    expect(parts.map((part) => part.segments.length)).toEqual([5, 5, 2]);
});
