import type { Page } from "@playwright/test";
import { inoreaderSubscriptions } from "./fake-api/fixtures.ts";
import { closeDialog, connectInoreader, expect, focusedArticle, headerMessage, requests, test } from "./fixtures.ts";

const ALPHA = "feed/https://alpha.example.com/rss";
/** A paragraph with nested inline markup, and code that stays as it is. */
const MARKUP_HTML =
    '<p>Read <a href="https://example.com/docs" title="Documentation">the <strong>docs</strong></a> now. <em>Run</em> <code>npm <strong>install</strong></code>.</p><pre><code>npm install</code></pre>';
const TRANSLATED_MARKUP = "[ja] Read [ja] the [ja] docs[ja]  now. [ja] Run npm install[ja] .";
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
        { texts: ["Body of alpha article 1."], sourceLanguage: "en", targetLanguage: "ja", stream: true }
    ]);
});

for (const segments of [true, false]) {
    test(`translates link labels without rebuilding links with segments capability ${segments}`, async ({
        page,
        api
    }) => {
        await api.control("POST", "/local/config", { segments });
        await moveTo(page, "alpha article 2");
        const paragraph = body(page).locator("p");
        const link = await paragraph.locator("a").elementHandle();
        const strong = await paragraph.locator("a > strong").elementHandle();
        const code = await paragraph.locator("code").elementHandle();
        const markup = await body(page).innerHTML();
        await page.keyboard.press("Shift+T");

        await expect(paragraph).toHaveText(TRANSLATED_MARKUP);
        await expect(paragraph.locator('a[href="https://example.com/docs"]')).toHaveText("[ja] the [ja] docs");
        await expect(paragraph.locator("a")).toHaveAttribute("title", "the docs");
        await expect(paragraph.locator("a > strong")).toHaveText("[ja] docs");
        await expect(paragraph.locator("em")).toHaveText("[ja] Run");
        await expect(paragraph.locator("code")).toHaveText("npm install");
        await expect(body(page).locator("pre")).toHaveText("npm install");
        // Preserve the actual elements, including their children, rather than rebuilding links.
        expect(await paragraph.locator("a").evaluate((element, original) => element === original, link)).toBe(true);
        expect(
            await paragraph.locator("a > strong").evaluate((element, original) => element === original, strong)
        ).toBe(true);
        expect(await paragraph.locator("code").evaluate((element, original) => element === original, code)).toBe(true);
        expect(await translateRequests(api)).toEqual([
            {
                texts: ["Read ", "the ", "docs", " now. ", "Run", "."],
                sourceLanguage: "en",
                targetLanguage: "ja",
                stream: true
            }
        ]);

        await page.keyboard.press("Shift+T");
        expect(await body(page).innerHTML()).toBe(markup);
        await expect(paragraph.locator("a")).toHaveAttribute("title", "Documentation");
        expect(await paragraph.locator("a").evaluate((element, original) => element === original, link)).toBe(true);
    });
}

test("discards a pending legacy translation after Shift+T turns it off", async ({ page, api }) => {
    await api.control("POST", "/local/config", { stream: false });
    const release = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    await page.route("**/api/translate", async (route) => {
        started.resolve();
        await release.promise;
        await route.fulfill({ json: { texts: ["Late translation"] } });
    });
    await page.keyboard.press("Shift+T");
    await started.promise;
    await page.keyboard.press("Shift+T");
    const completed = page.waitForResponse("**/api/translate");
    release.resolve();
    await completed;
    await expect(headerMessage(page)).toHaveText("Translate mode: OFF");
    await expect(body(page)).toHaveText("Body of alpha article 1.");
});

test("shows the local server's error", async ({ page, api }) => {
    await api.control("POST", "/local/config", { translateError: "language package is not installed: en -> ja" });
    await page.keyboard.press("Shift+T");
    await expect(headerMessage(page)).toHaveText("language package is not installed: en -> ja");
    await expect(body(page)).toHaveText("Body of alpha article 1.");
});

test("translates a long article in bounded streaming batches", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 1600 });
    await page.keyboard.press("Shift+T");
    await expect(body(page)).toHaveText("[ja] Body of alpha article 1.");
    await moveTo(page, "alpha article 3");
    await expect(body(page).locator("p")).toHaveText(LONG_PARAGRAPHS.map((text) => `[ja] ${text}`));

    const parts = (await translateRequests(api))
        .map((request) => request as { texts: string[] })
        .filter((request) => request.texts.some((text) => text.startsWith("Paragraph")));
    expect(parts.map((part) => part.texts.length)).toEqual([5, 5, 2]);
});

test("shows the first text without waiting for the rest of its batch", async ({ page, api }) => {
    await api.control("POST", "/local/config", { streamDelayMs: 2000 });
    await moveTo(page, "alpha article 3");
    const paragraphs = body(page).locator("p");
    await page.keyboard.press("Shift+T");
    await expect(paragraphs.first()).toHaveText(`[ja] ${LONG_PARAGRAPHS[0]}`, { timeout: 1000 });
    await expect(paragraphs.nth(1)).toHaveText(LONG_PARAGRAPHS[1]!);
    expect((await translateRequests(api)).length).toBe(1);
    await page.keyboard.press("Shift+T");
    await expect(paragraphs).toHaveText(LONG_PARAGRAPHS);
});

test("matches out-of-order streamed results without changing links", async ({ page, api }) => {
    await api.control("POST", "/local/config", { reverseStream: true });
    await moveTo(page, "alpha article 2");
    await page.keyboard.press("Shift+T");
    await expect(body(page).locator("p")).toHaveText(TRANSLATED_MARKUP);
    await expect(body(page).locator("a")).toHaveAttribute("href", "https://example.com/docs");
    await expect(body(page).locator("a")).toHaveAttribute("title", "the docs");
});

test("starts at the visible paragraphs and resumes when scrolling to untranslated text", async ({ page, api }) => {
    await moveTo(page, "alpha article 3");
    await body(page)
        .locator("p")
        .evaluateAll((elements) => {
            for (const element of elements) (element as HTMLElement).style.minHeight = "400px";
        });
    const paragraphs = body(page).locator("p");
    await paragraphs.nth(6).evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.keyboard.press("Shift+T");
    await expect(paragraphs.nth(6)).toHaveText(`[ja] ${LONG_PARAGRAPHS[6]}`);
    await expect(paragraphs.first()).toHaveText(LONG_PARAGRAPHS[0]!);
    await expect(paragraphs.last()).toHaveText(LONG_PARAGRAPHS[11]!);
    const sent = (await translateRequests(api)) as { texts: string[] }[];
    expect(sent[0]?.texts[0]).toBe(LONG_PARAGRAPHS[6]);

    await paragraphs.first().evaluate((element) => element.scrollIntoView({ block: "start" }));
    await expect(paragraphs.first()).toHaveText(`[ja] ${LONG_PARAGRAPHS[0]}`);
    await page.keyboard.press("Shift+T");
    await expect(paragraphs).toHaveText(LONG_PARAGRAPHS);
});

test("cancels a partially delivered stream on OFF and restores all original markup", async ({ page, api }) => {
    await api.control("POST", "/local/config", { streamDelayMs: 2000 });
    await moveTo(page, "alpha article 3");
    const markup = await body(page).innerHTML();
    await page.keyboard.press("Shift+T");
    await expect(body(page).locator("p").first()).toContainText("[ja] Paragraph 01");
    const cancelled = page.waitForEvent("requestfailed", (request) => request.url().endsWith("/api/translate"));
    await page.keyboard.press("Shift+T");
    await cancelled;
    expect(await body(page).innerHTML()).toBe(markup);
    await expect(headerMessage(page)).toHaveText("Translate mode: OFF");
});

test("applies a paragraph's inline pieces together rather than flashing individual words", async ({ page, api }) => {
    await api.control("POST", "/local/config", { streamDelayMs: 150 });
    await moveTo(page, "alpha article 2");
    const response = page.waitForResponse("**/api/translate");
    await page.keyboard.press("Shift+T");
    await response;
    await expect(body(page).locator("p")).toHaveText("Read the docs now. Run npm install.");
    await expect(body(page).locator("p")).toHaveText(TRANSLATED_MARKUP);
});

for (const title of [null, ""]) {
    test(`restores an originally ${title === null ? "absent" : "empty"} link title after repeated toggles`, async ({
        page
    }) => {
        await moveTo(page, "alpha article 2");
        const link = body(page).locator("a");
        await link.evaluate((element, value) => {
            if (value === null) element.removeAttribute("title");
            else element.setAttribute("title", value);
        }, title);
        const markup = await body(page).innerHTML();
        for (const round of [1, 2]) {
            await test.step(`toggle ${round}`, async () => {
                await page.keyboard.press("Shift+T");
                await expect(link).toHaveText("[ja] the [ja] docs");
                await expect(link).toHaveAttribute("title", "the docs");
                await page.keyboard.press("Shift+T");
                await expect(link).toHaveText("the docs");
                expect(await link.getAttribute("title")).toBe(title);
                expect(await body(page).innerHTML()).toBe(markup);
            });
        }
    });
}

test("ordinary scrolling to another article starts its translation", async ({ page }) => {
    await page.keyboard.press("Shift+T");
    await expect(body(page)).toHaveText("[ja] Body of alpha article 1.");
    const third = page.locator(".SubscriptionContentsContainer-content").filter({ hasText: "alpha article 3" });
    await third.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await expect(focusedArticle(page)).toContainText("alpha article 3");
    await expect(third.locator("p").first()).toHaveText(`[ja] ${LONG_PARAGRAPHS[0]}`);
});
