import * as React from "react";
import { BaseContainer } from "../../../BaseContainer";
import classnames from "classnames";
import { SubscriptionContentsState } from "./SubscriptionContentsStore";
import { SubscriptionContent } from "../../../../../domain/Subscriptions/SubscriptionContent/SubscriptionContent";
import { Link } from "office-ui-fabric-react";

export interface SubscriptionContentsContainerProps {
    subscriptionContents: SubscriptionContentsState;
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

    componentWillUpdate(nextProps: SubscriptionContentsContainerProps) {
        if (this.props.subscriptionContents !== nextProps.subscriptionContents) {
            if (this.element) {
                this.element.scrollTo(0, 0);
            }
        }
    }

    private makeContent(content: SubscriptionContent, index: number) {
        return (
            <div className="SubscriptionContentsContainer-content" key={`${content.id.toValue()}-${index}`}>
                <h2>
                    <Link href={content.url} target="_blank" rel="noopener">
                        {content.title}
                    </Link>
                </h2>
                <div
                    className="SubscriptionContentsContainer-contentBody"
                    dangerouslySetInnerHTML={{ __html: content.body.HTMLString }}
                />
            </div>
        );
    }
}
