import { inoreaderSubscriptions } from "./fake-api/fixtures.ts";
import {
    articles,
    closeDialog,
    connectInoreader,
    currentFeed,
    expect,
    feedRow,
    focusedArticle,
    headerMessage,
    test
} from "./fixtures.ts";

// CSS viewport of iPhone Duo, folded and unfolded in portrait. Apple does not publish these values; they are the
// ones reported by https://iphoneduosupport.com/blog/websites-on-iphone-duo/.
const FOLDED = { width: 466, height: 678 };
const UNFOLDED = { width: 626, height: 890 };

test.use({ hasTouch: true });

test.beforeEach(async ({ api, page }) => {
    await api.reset({ inoreader: { subscriptions: inoreaderSubscriptions() } });
    await connectInoreader(page);
    await closeDialog(page);
});

test("tap controls do what s, j and k do", async ({ page }) => {
    await page.setViewportSize(UNFOLDED);
    const controls = page.getByRole("toolbar", { name: "Reading controls" });
    await controls.getByRole("button", { name: "Next feed (s)" }).tap();
    await expect(currentFeed(page)).toHaveText("Alpha Blog (3)");
    await expect(articles(page)).toHaveCount(3);

    await controls.getByRole("button", { name: "Next item (j)" }).tap();
    await expect(focusedArticle(page)).toContainText("alpha article 1");
    await controls.getByRole("button", { name: "Next item (j)" }).tap();
    await expect(focusedArticle(page)).toContainText("alpha article 2");
    await controls.getByRole("button", { name: "Previous item (k)" }).tap();
    await expect(focusedArticle(page)).toContainText("alpha article 1");

    await controls.getByRole("button", { name: "Next feed (s)" }).tap();
    await expect(currentFeed(page)).toHaveText("Beta Blog (1)");
    // Keyboard shortcuts keep working after a tap.
    await page.keyboard.press("s");
    await expect(currentFeed(page)).toHaveText("Gamma News (5)");
});

test("the sidebar is a drawer when folded and a column when unfolded", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Subscriptions" });
    const toggle = page.getByRole("button", { name: "Toggle subscriptions" });

    await page.setViewportSize(UNFOLDED);
    await expect(nav).toBeVisible();
    await toggle.tap();
    await expect(nav).toBeHidden();
    await toggle.tap();
    await expect(nav).toBeVisible();

    await page.setViewportSize(FOLDED);
    await expect(nav).toBeHidden();
    await toggle.tap();
    await expect(nav).toBeVisible();
    // Opening a feed from the drawer closes it.
    await feedRow(page, "Beta Blog").tap();
    await expect(nav).toBeHidden();
    await expect(headerMessage(page)).not.toHaveText("Loading…");
    await expect(articles(page)).toHaveCount(1);

    await toggle.tap();
    await expect(nav).toBeVisible();
    await page.getByRole("button", { name: "Close subscriptions" }).tap({ position: { x: 440, y: 300 } });
    await expect(nav).toBeHidden();

    // Unfolding shows the column again: the drawer state does not carry over.
    await page.setViewportSize(UNFOLDED);
    await expect(nav).toBeVisible();
});

test("tap controls follow keys rebound by a user script", async ({ page }) => {
    await page.setViewportSize(UNFOLDED);
    await expect.poll(() => page.evaluate(() => window.userScript !== undefined)).toBe(true);
    await page.evaluate(() => {
        const target = window as unknown as { rebound: number };
        target.rebound = 0;
        window.userScript?.registerKey("j", () => {
            target.rebound++;
        });
    });
    const controls = page.getByRole("toolbar", { name: "Reading controls" });
    await controls.getByRole("button", { name: "Next feed (s)" }).tap();
    await expect(articles(page)).toHaveCount(3);
    await controls.getByRole("button", { name: "Next item (j)" }).tap();
    await controls.getByRole("button", { name: "Next item (j)" }).tap();
    await expect.poll(() => page.evaluate(() => (window as unknown as { rebound: number }).rebound)).toBe(2);
    // The default j would have moved to the second article.
    await expect(focusedArticle(page)).toContainText("alpha article 1");
});
