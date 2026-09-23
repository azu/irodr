import { test as base, expect, type Page } from "@playwright/test";
import type { LoggedRequest, Scenario } from "./fake-api/server.ts";

export const FAKE_API = "http://127.0.0.1:4010";

export interface FakeApi {
    reset(scenario?: Scenario): Promise<void>;
    log(): Promise<LoggedRequest[]>;
    control<T = unknown>(method: "GET" | "POST", path: string, data?: unknown): Promise<T>;
}

export const test = base.extend<{ api: FakeApi }>({
    api: async ({ request }, use) => {
        const control = async <T>(method: "GET" | "POST", path: string, data?: unknown): Promise<T> => {
            const response = await request.fetch(`${FAKE_API}/__control${path}`, { method, data });
            expect(response.ok(), `${method} ${path}`).toBe(true);
            return (await response.json()) as T;
        };
        const api: FakeApi = {
            reset: async (scenario = {}) => {
                await control("POST", "/reset", scenario);
            },
            log: () => control<LoggedRequest[]>("GET", "/log"),
            control
        };
        await api.reset();
        await use(api);
    }
});

export { expect };

export function feedRow(page: Page, title: string) {
    return page.locator(".SubscriptionListContainer-item", { hasText: title });
}

export function currentFeed(page: Page) {
    return page.locator('.SubscriptionListContainer-item[aria-current="true"]');
}

export function articles(page: Page) {
    return page.locator(".SubscriptionContentsContainer-content");
}

export function focusedArticle(page: Page) {
    return page.locator('.SubscriptionContentsContainer-content[data-focused="true"]');
}

export function headerMessage(page: Page) {
    return page.getByTestId("header-message");
}

/** Log in through the fake Inoreader consent page. */
export async function connectInoreader(page: Page): Promise<void> {
    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: "Sources" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Connect to Inoreader" }).click();
    await page.locator("#authorize").click();
    await expect(page).toHaveURL("http://127.0.0.1:4173/");
    await expect(page.locator(".SubscriptionListContainer-item").first()).toBeVisible();
}

/** Connect GitHub with a personal access token from the Sources dialog. */
export async function connectGitHub(page: Page, token = "ghp_valid"): Promise<void> {
    const dialog = page.getByRole("dialog", { name: "Sources" });
    if (!(await dialog.isVisible())) await page.getByRole("button", { name: "Sources" }).click();
    await dialog.getByLabel("Classic personal access token").fill(token);
    await dialog.getByRole("button", { name: "Connect GitHub" }).click();
    await expect(page.getByTestId("source-result-github-notifications")).toHaveText("GitHub connected.");
}

export async function closeDialog(page: Page): Promise<void> {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
}

export function requests(log: LoggedRequest[], service: LoggedRequest["service"], path: string | RegExp) {
    return log.filter(
        (entry) => entry.service === service && (typeof path === "string" ? entry.path === path : path.test(entry.path))
    );
}
