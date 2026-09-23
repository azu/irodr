import { defineConfig, devices } from "@playwright/test";

const FAKE_API = "http://127.0.0.1:4010";
const APP = "http://127.0.0.1:4173";
const CI = Boolean(process.env.CI);

/**
 * Integration tests: the production build (`vp build --mode e2e`) talks to fake
 * Inoreader and GitHub services (e2e/fake-api). Run with `pnpm run test:e2e`.
 */
export default defineConfig({
    testDir: "e2e",
    testMatch: "**/*.spec.ts",
    // Tests share one fake API server and reset it per test.
    fullyParallel: false,
    workers: 1,
    forbidOnly: CI,
    timeout: 30_000,
    expect: { timeout: 5_000 },
    reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
    use: {
        baseURL: APP,
        trace: "retain-on-failure",
        screenshot: "only-on-failure"
    },
    projects: [
        {
            name: "chromium",
            use: {
                ...devices["Desktop Chrome"],
                viewport: { width: 1280, height: 800 },
                launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
                    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
                    : {}
            }
        }
    ],
    webServer: [
        {
            command: "node e2e/fake-api/main.ts --port 4010",
            url: `${FAKE_API}/__control/health`,
            reuseExistingServer: !CI
        },
        {
            command: "vp preview --outDir dist-e2e --port 4173 --strictPort --host 127.0.0.1",
            url: APP,
            reuseExistingServer: !CI
        }
    ]
});
