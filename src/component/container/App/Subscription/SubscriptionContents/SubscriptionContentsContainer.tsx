import * as React from "react";
import { BaseContainer } from "../../../BaseContainer";
import classnames from "classnames";
import { SubscriptionContentsState } from "./SubscriptionContentsStore";
import {
    SubscriptionContent,
    SubscriptionContentIdentifier
} from "../../../../../domain/Subscriptions/SubscriptionContent/SubscriptionContent";
import { Link } from "office-ui-fabric-react";
import { FocusContentUseCase } from "./use-case/FocusContentUseCase";
import { HTMLContent } from "../../../../ui-kit/HTMLContent";
import distanceInWordsToNow from "date-fns/distance_in_words_to_now";
import format from "date-fns/format";
import isEqual from "date-fns/is_equal";

export interface SubscriptionContentsContainerProps {
    subscriptionContents: SubscriptionContentsState;
}

/**
 * get Active Item from the scroll position
 * @see https://gist.github.com/azu/c306c1efa31f0f41aa01c5b69576d00c#file-reader_main-0-3-8-js-L1205
 * @returns {string}
 */
function getActiveItem(): string | undefined {
    const contentContainer = document.querySelector(".SubscriptionContentsContainer") as HTMLElement;
    const contentElements = document.querySelectorAll(".SubscriptionContentsContainer-content") as NodeListOf<
        HTMLElement
    >;
    const containerScrollTop = contentContainer.scrollTop;
    const containerOffsetHeight = contentContainer.offsetHeight;
    // TODO: should be computables
    // AppHeader's height = 32px
    const marginTopOfContentContainer = 32;
    const contentCount = contentElements.length;
    if (!contentCount) return;
    const offsets: number[] = [];
    for (let i = 0; i < contentCount; i++) {
        offsets.push(contentElements[i].offsetTop - marginTopOfContentContainer);
    }
    if (!contentContainer) {
        return;
    }
    const screen = [containerScrollTop, containerScrollTop + containerOffsetHeight];
    const pairs = offsets.map(function(v, i, element) {
        if (element[i + 1]) {
            return [v, element[i + 1]];
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
        const content = contentElements[0];
        return content.dataset.contentId;
    } else {
        if (full_contain.length > 0) {
            const offset = full_contain.shift();
            if (offset === undefined) {
                return;
            }
            const content = contentElements[offset];
            return content.dataset.contentId;
        } else {
            const max_intersection = Math.max.apply(null, intersections);
            const offset = max_intersection === 0 ? contentCount - 1 : intersections.indexOf(max_intersection);
            if (offset === undefined) {
                return;
            }
            const content = contentElements[offset];
            return content.dataset.contentId;
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
                <div role="main" className="SubscriptionContentsContainer-body">
                    {contents}
                </div>
                <footer className="SubscriptionContentsContainer-footer">
                    <div
                        className="SubscriptionContentsContainer-footerPadding"
                        style={{
                            height: 545
                        }}
                    />
                </footer>
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
        const scrollContentId = this.props.subscriptionContents.scrollContentId;
        if (scrollContentId && prevProps.subscriptionContents.scrollContentId !== scrollContentId) {
            this.scrollToContentId(scrollContentId);
        }
        this.updateCurrentFocus();
    }

    private onContentChange() {
        if (this.element) {
            const observer = new IntersectionObserver(
                entries => {
                    this.updateCurrentFocus();
                },
                {
                    root: this.element,
                    threshold: [0, 0.2, 0.4, 0.6, 0.8, 1.0]
                }
            );
            Array.from(document.querySelectorAll(".SubscriptionContentsContainer-content")).forEach(element => {
                observer.observe(element);
            });
        }
    }

    private updateCurrentFocus() {
        const activeItemId = getActiveItem();
        if (activeItemId) {
            const contentId = this.props.subscriptionContents.getContentId(activeItemId);
            if (!contentId.equals(this.props.subscriptionContents.focusContentId)) {
                this.useCase(new FocusContentUseCase()).executor(useCase => useCase.execute(contentId));
            }
        }
    }

    private makeContent(content: SubscriptionContent, index: number) {
        const isFocus = this.props.subscriptionContents.isFocusContent(content);
        const contentIdString = content.id.toValue();
        const author = content.author ? (
            <span>
                <span> by </span>
                <span className="SubscriptionContentsContainer-contentAuthor">{content.author}</span>
            </span>
        ) : null;
        const updatedFooter = isEqual(content.publishedDate, content.updatedDate) ? null : (
            <span>
                <span> | </span>
                <label>Updated: </label>
                <time
                    className="SubscriptionContentsContainer-contentUpdatedTime"
                    dateTime={content.updatedDate.toISOString()}
                >
                    {format(content.updatedDate, "YYYY-MM-DD mm:ss")}
                </time>
            </span>
        );
        return (
            <div
                className={classnames("SubscriptionContentsContainer-content", {
                    "is-focus": isFocus
                })}
                key={`${contentIdString}-${index}`}
                data-content-id={contentIdString}
            >
                <header className="SubscriptionContentsContainer-contentHeader">
                    <h2 className="SubscriptionContentsContainer-contentTitle">
                        <Link
                            className="SubscriptionContentsContainer-contentTitleLink"
                            href={content.url}
                            target="_blank"
                            rel="noopener"
                        >
                            {content.title}
                        </Link>
                    </h2>
                    <div>
                        <Link
                            className="SubscriptionContentsContainer-contentOriginalLink"
                            href={content.url}
                            target="_blank"
                            rel="noopener"
                        >
                            Original
                        </Link>
                        <span> | </span>
                        <time
                            className="SubscriptionContentsContainer-contentUpdatedTime"
                            dateTime={content.updatedDate.toISOString()}
                        >
                            {distanceInWordsToNow(content.updatedDate)}
                        </time>
                        {author}
                    </div>
                </header>
                <HTMLContent className="SubscriptionContentsContainer-contentBody">
                    {content.body.HTMLString}
                </HTMLContent>
                <footer className="SubscriptionContentsContainer-contentFooter">
                    <label>Posted: </label>
                    <time
                        className="SubscriptionContentsContainer-contentPostedTime"
                        dateTime={content.publishedDate.toISOString()}
                    >
                        {format(content.publishedDate, "YYYY-MM-DD mm:ss")}
                    </time>
                    {updatedFooter}
                </footer>
            </div>
        );
    }

    private scrollToContentId(scrollContentId: SubscriptionContentIdentifier) {
        const targetElement = document.querySelector(`[data-content-id="${scrollContentId.toValue()}"]`);
        if (targetElement) {
            targetElement.scrollIntoView();
        }
    }
}
