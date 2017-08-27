import * as React from "react";
import classnames from "classnames";

export interface HTMLContentProps {
    children: string;
    className: string;
}

export class HTMLContent extends React.PureComponent<HTMLContentProps, {}> {
    render() {
        return (
            <div
                className={classnames("SubscriptionContentsContainer-contentBody", this.props.className)}
                dangerouslySetInnerHTML={{ __html: this.props.children }}
            />
        );
    }
}
