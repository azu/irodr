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

test("tap controls work from the keyboard too", async ({ page }) => {
    await page.setViewportSize(UNFOLDED);
    await page.keyboard.press("s");
    await expect(articles(page)).toHaveCount(3);
    const next = page.getByRole("toolbar", { name: "Reading controls" }).getByRole("button", { name: "Next item (j)" });
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(focusedArticle(page)).toContainText("alpha article 1");
    await page.keyboard.press("Enter");
    await expect(focusedArticle(page)).toContainText("alpha article 2");
});

test("a swipe that starts on a tap control does nothing", async ({ page }) => {
    await page.setViewportSize(UNFOLDED);
    await page.keyboard.press("s");
    await expect(currentFeed(page)).toHaveText("Alpha Blog (3)");
    const next = page.getByRole("toolbar", { name: "Reading controls" }).getByRole("button", { name: "Next feed (s)" });
    const box = await next.boundingBox();
    if (!box) throw new Error("Next feed (s) is not visible");
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await next.dispatchEvent("pointerdown", {
        pointerId: 1,
        pointerType: "touch",
        button: 0,
        clientX: start.x,
        clientY: start.y
    });
    await next.dispatchEvent("pointerup", {
        pointerId: 1,
        pointerType: "touch",
        button: 0,
        clientX: start.x,
        clientY: start.y - 80
    });
    await next.dispatchEvent("pointerdown", {
        pointerId: 2,
        pointerType: "touch",
        button: 0,
        clientX: start.x,
        clientY: start.y
    });
    await next.dispatchEvent("pointercancel", { pointerId: 2, pointerType: "touch" });
    await next.dispatchEvent("pointerup", {
        pointerId: 2,
        pointerType: "touch",
        button: 0,
        clientX: start.x,
        clientY: start.y
    });
    // A press that ends on the neighbouring button presses neither.
    const nextItem = page
        .getByRole("toolbar", { name: "Reading controls" })
        .getByRole("button", { name: "Next item (j)" });
    await nextItem.dispatchEvent("pointerdown", {
        pointerId: 3,
        pointerType: "mouse",
        button: 0,
        clientX: start.x,
        clientY: start.y - 5
    });
    await next.dispatchEvent("pointerup", {
        pointerId: 3,
        pointerType: "mouse",
        button: 0,
        clientX: start.x,
        clientY: start.y
    });
    // A tap after them moves one feed: the swipes did not.
    await next.tap();
    await expect(currentFeed(page)).toHaveText("Beta Blog (1)");
});

test("header buttons act on a tap that has no click", async ({ page }) => {
    // iOS does not fire `click` for a tap that stops a momentum scroll: the header acts on pointerup.
    await page.setViewportSize(UNFOLDED);
    const preferences = page.getByRole("button", { name: "Preferences" });
    const box = await preferences.boundingBox();
    if (!box) throw new Error("Preferences is not visible");
    const point = { pointerId: 1, pointerType: "touch", button: 0, clientX: box.x + 4, clientY: box.y + 4 };
    await preferences.dispatchEvent("pointerdown", point);
    await preferences.dispatchEvent("pointerup", point);
    await expect(page.getByRole("dialog", { name: "App Preference" })).toBeVisible();
    await closeDialog(page);
    // An ordinary tap, with its click, opens it once too.
    await preferences.tap();
    await expect(page.getByRole("dialog", { name: "App Preference" })).toBeVisible();
});

test("the tap controls can move to the left side", async ({ page }) => {
    await page.setViewportSize(UNFOLDED);
    const controls = page.getByRole("toolbar", { name: "Reading controls" });
    const right = await controls.boundingBox();
    expect(right && right.x > UNFOLDED.width / 2).toBe(true);

    await page.getByRole("button", { name: "Preferences" }).tap();
    const dialog = page.getByRole("dialog", { name: "App Preference" });
    await dialog.getByLabel("Tap Controls Side").selectOption("left");
    await dialog.getByRole("button", { name: "Save" }).tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(controls).toHaveAttribute("data-side", "left");
    const left = await controls.boundingBox();
    if (!left) throw new Error("Reading controls are not visible");
    expect(left.x + left.width < UNFOLDED.width / 2).toBe(true);
    // A tap that misses the buttons lands on the control area, not on a feed under it.
    const missed = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="toolbar"]') !== null,
        { x: left.x + left.width - 4, y: left.y + left.height - 4 }
    );
    expect(missed).toBe(true);

    // Still works there, and the choice is kept.
    await controls.getByRole("button", { name: "Next feed (s)" }).tap();
    await expect(currentFeed(page)).toHaveText("Alpha Blog (3)");
    await page.reload();
    await expect(controls).toHaveAttribute("data-side", "left");
});

test("the read later button does what p does", async ({ page, api }) => {
    await page.setViewportSize(UNFOLDED);
    const controls = page.getByRole("toolbar", { name: "Reading controls" });
    await controls.getByRole("button", { name: "Next feed (s)" }).tap();
    await controls.getByRole("button", { name: "Next item (j)" }).tap();
    await expect(focusedArticle(page)).toContainText("alpha article 1");
    const readLater = controls.getByRole("button", { name: "Read later (p)" });
    await expect(readLater).toHaveAttribute("aria-pressed", "false");
    await readLater.tap();
    await expect(readLater).toHaveAttribute("aria-pressed", "true");
    await expect(focusedArticle(page).getByRole("button", { name: "Saved" })).toBeVisible();
    await expect.poll(async () => (await api.control<string[]>("GET", "/inoreader/saved")).length).toBe(1);
});
