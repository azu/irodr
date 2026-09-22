import * as React from "react";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { GitHubSourcePanel } from "../GitHubSourcePanel";
import { appLocator } from "../../../../AppLocator";
import { sourceCredentialsRepository } from "../../../../infra/repository/SourceCredentialsRepository";
import { sourceRepository } from "../../../../infra/repository/SourceRepository";
import { githubSourceSession } from "../../../../infra/sources/GitHubSourceService";
import {
    ConnectGitHubSourceUseCase,
    ForgetGitHubCredentialsUseCase,
    SetGitHubReleaseFilterUseCase
} from "../../../../use-case/source/GitHubSourceUseCases";

jest.mock("../../../../AppLocator", () => ({
    appLocator: { context: { useCase: jest.fn() } }
}));
jest.mock("../../../../infra/repository/SourceCredentialsRepository", () => ({
    sourceCredentialsRepository: { has: jest.fn() }
}));
jest.mock("../../../../infra/repository/SourceRepository", () => ({
    sourceRepository: { getSources: jest.fn() }
}));
jest.mock("../../../../infra/sources/GitHubSourceService", () => ({
    githubSourceSession: {
        isUnlocked: false,
        status: { phase: "locked", message: "" },
        subscribe: () => () => undefined
    }
}));
jest.mock("../../../../use-case/source/GitHubSourceUseCases", () => ({
    ConnectGitHubSourceUseCase: jest.fn(),
    SetGitHubReleaseFilterUseCase: jest.fn(),
    ForgetGitHubCredentialsUseCase: jest.fn()
}));

describe("GitHubSourcePanel", () => {
    let container: HTMLDivElement;
    let root: Root;
    const execute = jest.fn();
    const has = sourceCredentialsRepository.has as jest.Mock;
    const useCase = appLocator.context.useCase as jest.Mock;
    const setUnlocked = (value: boolean) => {
        // The production session exposes a getter; this test module supplies a mutable fixture.
        Object.defineProperty(githubSourceSession, "isUnlocked", { configurable: true, value, writable: true });
    };
    const button = (label: string) => {
        const found = Array.from(container.querySelectorAll("button")).find((element) => element.textContent === label);
        if (!found) {
            throw new Error(`Missing button: ${label}`);
        }
        return found;
    };
    const password = (index = 0) => container.querySelectorAll<HTMLInputElement>('input[type="password"]')[index];
    const change = (input: HTMLInputElement, value: string) => {
        act(() => {
            input.value = value;
            Simulate.change(input);
        });
    };
    const mount = async () => {
        await act(async () => {
            root.render(<GitHubSourcePanel />);
        });
    };
    const submit = async () => {
        await act(async () => {
            Simulate.submit(container.querySelector("form")!);
        });
    };
    const click = async (label: string) => {
        await act(async () => {
            Simulate.click(button(label));
        });
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (sourceRepository.getSources as jest.Mock).mockReturnValue([]);
        execute.mockReset().mockResolvedValue(undefined);
        has.mockReset().mockResolvedValue(false);
        useCase.mockReturnValue({ execute });
        setUnlocked(false);
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it("checks saved credentials on mount and uses a password field with storage warnings", async () => {
        await mount();
        expect(has).toHaveBeenCalledWith("github-notifications");
        expect(password().type).toBe("password");
        expect(password().autocomplete).toBe("off");
        expect(button("Connect GitHub").disabled).toBe(true);
        expect(container.textContent).toContain("private content");
        expect(container.textContent).toContain("are not encrypted");
        expect(container.textContent).toContain("Moving to another feed marks");
        expect(container.textContent).toContain("Shift+S skips without marking read");
    });

    it("connects with constructor credentials, zero execute arguments, and clears the token", async () => {
        await mount();
        change(password(), "  test-token  ");
        execute.mockImplementation(async () => setUnlocked(true));
        await submit();
        expect(ConnectGitHubSourceUseCase).toHaveBeenCalledWith("test-token");
        expect(execute.mock.calls).toEqual([[]]);
        expect(password().value).toBe("");
        expect(container.textContent).toContain("GitHub connected.");
        expect(button("Disconnect and forget token")).toBeTruthy();
    });

    it("saves without a passphrase and explains GitHub-managed unread state and automatic restore", async () => {
        await mount();
        change(password(), "test-token");
        expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);
        expect(container.querySelector('input[type="checkbox"]')).toBeNull();
        expect(container.textContent).toContain("without a date cutoff");
        expect(container.textContent).toContain("Unread notifications of all types");
        expect(container.textContent).toContain("saved unencrypted");
        expect(container.textContent).toContain("restored automatically");
        has.mockResolvedValue(true);
        await submit();
        expect(ConnectGitHubSourceUseCase).toHaveBeenCalledWith("test-token");
        expect(execute.mock.calls).toEqual([[]]);
        expect(password().value).toBe("");
    });

    it("disables the form while working and reports safe errors without leaking secrets", async () => {
        let reject: (error: Error) => void = () => {};
        execute.mockReturnValue(
            new Promise((_resolve, rejectPromise) => {
                reject = rejectPromise;
            })
        );
        await mount();
        change(password(), "private-token");
        await submit();
        expect(container.querySelector("fieldset")!.disabled).toBe(true);
        expect(container.textContent).toContain("Working…");
        await act(async () => {
            reject(new Error("private-token server response"));
        });
        expect(container.querySelector("fieldset")!.disabled).toBe(false);
        expect(container.textContent).toContain("GitHub action failed.");
        expect(container.textContent).not.toContain("private-token");
        expect(container.textContent).not.toContain("server response");
    });

    it("disconnects an active session and forgets the saved token", async () => {
        has.mockResolvedValue(true);
        setUnlocked(true);
        await mount();
        execute.mockImplementation(async () => setUnlocked(false));
        has.mockResolvedValue(false);
        await click("Disconnect and forget token");
        expect(ForgetGitHubCredentialsUseCase).toHaveBeenCalledWith();
        expect(execute.mock.calls).toEqual([[]]);
        expect(container.textContent).toContain("GitHub disconnected and saved token removed.");
        expect(container.textContent).not.toContain("Unlock saved token");
    });

    it("recovers from a failed saved-credential lookup with a safe status", async () => {
        has.mockRejectedValue(new Error("sensitive storage detail"));
        await mount();
        expect(container.querySelector("fieldset")!.disabled).toBe(false);
        expect(container.textContent).toContain("Could not check saved GitHub credentials.");
        expect(container.textContent).not.toContain("sensitive storage detail");
    });

    it("defaults to all types and offers a display-only Release filter in Sources", async () => {
        const getSources = sourceRepository.getSources as jest.Mock;
        getSources.mockReturnValue([{ id: "github-notifications", config: {} }]);
        await mount();
        const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        expect(checkbox.checked).toBe(false);
        execute.mockImplementation(async () => {
            getSources.mockReturnValue([{ id: "github-notifications", config: { releaseOnly: true } }]);
        });
        await act(async () => {
            checkbox.checked = true;
            Simulate.change(checkbox);
        });
        expect(SetGitHubReleaseFilterUseCase).toHaveBeenCalledWith();
        expect(execute).toHaveBeenCalledWith(true);
        expect(checkbox.checked).toBe(true);
        expect(container.textContent).toContain("repository read still includes all types");
        expect(container.textContent).not.toContain("GitHub sync complete");
        expect(
            Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "GitHub settings")
        ).toBe(false);
    });
});
