import * as React from "react";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { SubscriptionContentComponent } from "../SubscriptionContentComponent";
import { SubscriptionContentType, SubscriptionContentsState } from "../../SubscriptionContentsStore";
import { SubscriptionContentsContainer } from "../../SubscriptionContentsContainer";
import { SourceRepository } from "../../../../../../../infra/repository/SourceRepository";
import { SubscriptionRepository } from "../../../../../../../infra/repository/SubscriptionRepository";
import {
    projectSourceSubscriptions,
    githubRepositorySubscriptionId
} from "../../../../../../../infra/sources/SourceSubscription";

// These tests exercise article presentation, not HTML sanitization. Its ESM-only parser
// dependency is handled by webpack but not by the legacy Jest transform.
jest.mock("../../../../../../ui-kit/HTMLContent", () => {
    const React = require("react");
    return { HTMLContent: ({ children }: { children: string }) => React.createElement("div", null, children) };
});

describe("Article presentation without read buttons", () => {
    let container: HTMLDivElement;
    let root: Root;
    const props = {
        isFocus: false,
        contentId: "source:github-notifications:42",
        author: "owner/repo",
        url: "https://github.com/owner/repo/releases/tag/v1",
        title: "Release v1",
        body: "Notes",
        updateType: SubscriptionContentType.NEW,
        updatedDate: new Date("2026-01-01T00:00:00Z"),
        publishedDate: new Date("2026-01-01T00:00:00Z")
    };

    beforeEach(() => {
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it("shows GitHub release content without a per-article read button", () => {
        act(() => root.render(<SubscriptionContentComponent {...props} />));
        expect(container.querySelector("button")).toBeNull();
        expect(container.textContent).toContain("Release v1");
        expect(container.textContent).toContain("Notes");
        expect(container.querySelector("a")?.href).toBe(props.url);
    });

    it("does not add GitHub controls to Inoreader articles", () => {
        act(() => root.render(<SubscriptionContentComponent {...props} contentId="inoreader-item" />));
        expect(container.querySelector("button")).toBeNull();
    });

    it("renders a GitHub feed without settings buttons or sync statistics", async () => {
        const snapshot = {
            sources: [{ id: "github-notifications", adapterType: "github-notifications", config: {} }],
            items: [
                {
                    sourceId: "github-notifications",
                    externalId: "42",
                    title: "Issue title",
                    url: props.url,
                    content: "Issue body",
                    updatedAt: "2026-01-01T00:00:00Z",
                    metadata: { type: "Issue", repository: "owner/repo", githubUnread: true }
                }
            ],
            states: []
        };
        const cache = new SourceRepository({
            getItem: async <T,>() => snapshot as unknown as T,
            setItem: async <T,>(_key: string, value: T) => value
        });
        await cache.ready();
        const subscriptions = new SubscriptionRepository();
        projectSourceSubscriptions(cache, subscriptions);
        const feed = subscriptions.findById(githubRepositorySubscriptionId("owner/repo"))!;
        const state = new SubscriptionContentsState({ enableContentFilter: true, isContentsLoadings: false }).update(
            feed
        );
        const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
        Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: jest.fn() });
        try {
            act(() => root.render(<SubscriptionContentsContainer subscriptionContents={state} />));
            expect(container.textContent).toContain("Issue title");
            expect(container.textContent).not.toContain("GitHub settings");
            expect(container.textContent).not.toContain("GitHub sync");
            expect(container.textContent).not.toContain("Pages:");
        } finally {
            if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
            else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
        }
    });
});
