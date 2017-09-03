import * as React from "react";
import classnames from "classnames";

export interface TimeProps {
    className?: string;
    dateTime: string;
    children: React.ReactChild;
}

export class Time extends React.Component<TimeProps, {}> {
    render() {
        return (
            <time
                className={classnames("Time", this.props.className)}
                dateTime={this.props.dateTime}
                title={this.props.dateTime}
            >
                {this.props.children}
            </time>
        );
    }
}
