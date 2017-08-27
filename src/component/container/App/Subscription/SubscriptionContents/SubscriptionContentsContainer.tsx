import * as React from "react";
import { BaseContainer } from "../../../BaseContainer";
import classnames from "classnames";
import { SubscriptionContentsState } from "./SubscriptionContentsStore";
import { SubscriptionContent } from "../../../../../domain/Subscriptions/SubscriptionContent/SubscriptionContent";
import { Link } from "office-ui-fabric-react";
import { FocusContentUseCase } from "./use-case/FocusContentUseCase";
import { HTMLContent } from "../../../../ui-kit/HTMLContent";

export interface SubscriptionContentsContainerProps {
    subscriptionContents: SubscriptionContentsState;
}

/**
 * get Active Item from the scroll position
 * https://gist.github.com/anonymous/2d8641f3cbd24753dac81bfc992870da
 * @returns {string}
 */
function getActiveItem(): string | undefined {
    // return 1;
    const rightBody = document.querySelector(".SubscriptionContentsContainer") as HTMLElement;
    const h2Elements = document.querySelectorAll(".SubscriptionContentsContainer-contentTitle") as NodeListOf<
        HTMLElement
    >;
    const containerScrollTop = rightBody.scrollTop;
    const containerOffsetHeight = rightBody.offsetHeight;

    const contentCount = h2Elements.length;
    if (!contentCount) return;
    const offsets = [];
    for (let i = 0; i < contentCount; i++) {
        offsets.push(h2Elements[i].offsetTop);
    }
    if (!rightBody) {
        return;
    }
    const screen = [containerScrollTop, containerScrollTop + containerOffsetHeight];
    const pairs = offsets.map(function(v, i, self) {
        if (self[i + 1]) {
            return [v, self[i + 1]];
        } else {
            return [v, containerOffsetHeight];
        }
    });
    const full_contain: number[] = [];
    const intersections = pairs.map(function(pair, i) {
        if (pair[1] < screen[0]) return 0;
        if (pair[0] > screen[1]) return 0;
        const top = Math.max(screen[0], pair[0]);
        const bottom = Math.min(screen[1], pair[1]);
        if (top == pair[0] && bottom == pair[1]) {
            full_contain.push(i);
        }
        return bottom - top;
    });
    if (contentCount == 1) {
        const h2Element = h2Elements[0];
        return h2Element.dataset.contentId;
    } else {
        if (full_contain.length > 0) {
            const offset = full_contain.shift();
            if (offset === undefined) {
                return;
            }
            const h2Element = h2Elements[offset];
            return h2Element.dataset.contentId;
        } else {
            const max_intersection = Math.max.apply(null, intersections);
            const offset = max_intersection === 0 ? contentCount - 1 : intersections.indexOf(max_intersection);
            if (offset === undefined) {
                return;
            }
            const h2Element = h2Elements[offset];
            return h2Element.dataset.contentId;
        }
    }
}

export class SubscriptionContentsContainer extends BaseContainer<SubscriptionContentsContainerProps, {}> {
    element: HTMLDivElement | null;

    render() {
        const contents = this.props.subscriptionContents.contents
            ? this.props.subscriptionContents.contents
                  .getContents()
                  .map((content, index) => this.makeContent(content, index))
            : "No contents";
        return (
            <div
                ref={c => (this.element = c)}
                className={classnames("SubscriptionContentsContainer", this.props.className)}
            >
                {contents}
            </div>
        );
    }

    componentDidUpdate(prevProps: SubscriptionContentsContainerProps) {
        if (prevProps.subscriptionContents.contents !== this.props.subscriptionContents.contents) {
            if (this.element) {
                this.element.scrollTo(0, 0);
            }
            this.onContentChange();
        }
    }

    private onContentChange() {
        if (this.element) {
            const observer = new IntersectionObserver(
                entries => {
                    const activeItemId = getActiveItem();
                    console.log("activeItemId", activeItemId);
                    if (activeItemId) {
                        const contentId = this.props.subscriptionContents.getContentId(activeItemId);
                        this.useCase(new FocusContentUseCase()).executor(useCase => useCase.execute(contentId));
                    }
                },
                {
                    root: this.element,
                    threshold: [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1.0]
                }
            );
            Array.from(document.querySelectorAll(".SubscriptionContentsContainer-content")).forEach(element => {
                observer.observe(element);
            });
        }
    }

    private makeContent(content: SubscriptionContent, index: number) {
        const isFocus = this.props.subscriptionContents.isFocusContent(content);
        return (
            <div
                className={classnames("SubscriptionContentsContainer-content", {
                    "is-focus": isFocus
                })}
                key={`${content.id.toValue()}-${index}`}
            >
                <h2 className="SubscriptionContentsContainer-contentTitle" data-content-id={content.id.toValue()}>
                    <Link href={content.url} target="_blank" rel="noopener">
                        {content.title}
                    </Link>
                </h2>
                <HTMLContent className="SubscriptionContentsContainer-contentBody">
                    {content.body.HTMLString}
                </HTMLContent>
            </div>
        );
    }
}
