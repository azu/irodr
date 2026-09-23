import type { Page } from "@playwright/test";
import { inoreaderSubscriptions } from "./fake-api/fixtures.ts";
import { closeDialog, connectInoreader, expect, focusedArticle, headerMessage, test } from "./fixtures.ts";

const ALPHA = "feed/https://alpha.example.com/rss";
/** A paragraph with nested inline markup, and code that stays as it is. */
const MARKUP_HTML =
    '<p>Read <a href="https://example.com/docs" title="Documentation">the <strong>docs</strong></a> now. <em>Run</em> <code>npm <strong>install</strong></code>.</p><pre><code>npm install</code></pre>';
const TRANSLATED_MARKUP = "[ja] Read [ja] the [ja] docs[ja]  now. [ja] Run npm install[ja] .";
/** 12 paragraphs of 200 characters: translated in parts, visible ones first. */
const LONG_PARAGRAPHS = Array.from({ length: 12 }, (_, index) =>
    `Paragraph ${String(index + 1).padStart(2, "0")} `.padEnd(200, "x")
);
const CONTENTS = [undefined, MARKUP_HTML, LONG_PARAGRAPHS.map((text) => `<p>${text}</p>`).join("")];

type TestWindow = Window & { translatorCalls: string[][]; translatorDelayMs: number };

test.beforeEach(async ({ api, page }) => {
    // A browser without the Translator API (e.g. Firefox), with a user script translator that records its calls.
    await page.addInitScript(() => {
        Object.defineProperty(window, "Translator", { value: undefined, configurable: true });
        const target = window as unknown as TestWindow;
        target.translatorCalls = [];
        target.translatorDelayMs = 0;
        window.irodrTranslator = {
            translateBatch: async (texts) => {
                target.translatorCalls.push(texts);
                await new Promise((resolve) => setTimeout(resolve, target.translatorDelayMs));
                return texts.map((text) => `[ja] ${text}`);
            }
        };
    });
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

function translatorCalls(page: Page): Promise<string[][]> {
    return page.evaluate(() => (window as unknown as TestWindow).translatorCalls);
}

test("Shift+T translates the focused article and restores the original", async ({ page }) => {
    await expect(body(page)).toHaveText("Body of alpha article 1.");
    await page.keyboard.press("Shift+T");
    await expect(headerMessage(page)).toHaveText("Translate mode: ON");
    await expect(body(page)).toHaveText("[ja] Body of alpha article 1.");

    await page.keyboard.press("Shift+T");
    await expect(headerMessage(page)).toHaveText("Translate mode: OFF");
    await expect(body(page)).toHaveText("Body of alpha article 1.");
    expect(await translatorCalls(page)).toEqual([["Body of alpha article 1."]]);
});

test("translates link labels without rebuilding links", async ({ page }) => {
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
    expect(await paragraph.locator("a > strong").evaluate((element, original) => element === original, strong)).toBe(
        true
    );
    expect(await paragraph.locator("code").evaluate((element, original) => element === original, code)).toBe(true);
    expect(await translatorCalls(page)).toContainEqual(["Read ", "the ", "docs", " now. ", "Run", "."]);

    await page.keyboard.press("Shift+T");
    expect(await body(page).innerHTML()).toBe(markup);
    await expect(paragraph.locator("a")).toHaveAttribute("title", "Documentation");
    expect(await paragraph.locator("a").evaluate((element, original) => element === original, link)).toBe(true);
});

test("starts at the visible paragraphs and resumes when scrolling to untranslated text", async ({ page }) => {
    await moveTo(page, "alpha article 3");
    await body(page)
        .locator("p")
        .evaluateAll((elements) => {
            for (const element of elements) (element as HTMLElement).style.minHeight = "400px";
        });
    const paragraphs = body(page).locator("p");
    await paragraphs.nth(6).evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.evaluate(() => {
        (window as unknown as TestWindow).translatorCalls = [];
    });
    await page.keyboard.press("Shift+T");
    await expect(paragraphs.nth(6)).toHaveText(`[ja] ${LONG_PARAGRAPHS[6]}`);
    await expect(paragraphs.first()).toHaveText(LONG_PARAGRAPHS[0]!);
    await expect(paragraphs.last()).toHaveText(LONG_PARAGRAPHS[11]!);
    expect((await translatorCalls(page))[0]?.[0]).toBe(LONG_PARAGRAPHS[6]);

    await paragraphs.first().evaluate((element) => element.scrollIntoView({ block: "start" }));
    await expect(paragraphs.first()).toHaveText(`[ja] ${LONG_PARAGRAPHS[0]}`);
    await page.keyboard.press("Shift+T");
    await expect(paragraphs).toHaveText(LONG_PARAGRAPHS);
});

test("discards a pending translation after Shift+T turns it off", async ({ page }) => {
    await page.evaluate(() => {
        (window as unknown as TestWindow).translatorDelayMs = 500;
    });
    await moveTo(page, "alpha article 2");
    const markup = await body(page).innerHTML();
    await page.keyboard.press("Shift+T");
    await expect.poll(async () => (await translatorCalls(page)).length).toBeGreaterThan(0);
    await page.keyboard.press("Shift+T");
    await expect(headerMessage(page)).toHaveText("Translate mode: OFF");
    await page.waitForTimeout(700);
    expect(await body(page).innerHTML()).toBe(markup);
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
