import * as React from "react";
import { SubscriptionContentType } from "../SubscriptionContentsStore";

const distanceInWordsToNow = require("date-fns/distance_in_words_to_now");
const format = require("date-fns/format");
import classnames from "classnames";
import { Link } from "office-ui-fabric-react";
import { HTMLContent } from "../../../../../ui-kit/HTMLContent";
import { UserScriptHookComponent } from "../../../Hidden/UserScript/UserScriptHookComponent";

export interface SubscriptionContentProps {
    isFocus: boolean;
    contentId: string;
    author: string;
    url: string;
    title: string;
    body: string; // HTML string
    updateType: SubscriptionContentType;
    updatedDate: Date;
    publishedDate: Date;
}

export class SubscriptionContentComponent extends UserScriptHookComponent<SubscriptionContentProps, {}> {
    displayName = "SubscriptionContent";

    render() {
        const isFocus = this.props.isFocus;
        const updateType = this.props.updateType;
        const contentIdString = this.props.contentId;
        const author = this.props.author ? (
            <span>
                <span> by </span>
                <span className="SubscriptionContentsContainer-contentAuthor">{this.props.author}</span>
            </span>
        ) : null;
        const updatedFooter =
            this.props.updateType !== SubscriptionContentType.UPDATED ? null : (
                <span>
                    <span> | </span>
                    <label>Updated: </label>
                    <time
                        className="SubscriptionContentsContainer-contentUpdatedTime"
                        dateTime={this.props.updatedDate.toISOString()}
                    >
                        {format(this.props.updatedDate, "YYYY-MM-DD mm:ss")}
                    </time>
                </span>
            );
        return (
            <div
                className={classnames("SubscriptionContentsContainer-content", {
                    "is-focus": isFocus,
                    "is-new": updateType === SubscriptionContentType.NEW,
                    "is-updated": updateType === SubscriptionContentType.UPDATED
                })}
                key={contentIdString}
                data-content-id={contentIdString}
            >
                <header className="SubscriptionContentsContainer-contentHeader">
                    <h2 className="SubscriptionContentsContainer-contentTitle">
                        <Link
                            className="SubscriptionContentsContainer-contentTitleLink"
                            href={this.props.url}
                            target="_blank"
                            rel="noopener"
                        >
                            {this.props.title}
                        </Link>
                    </h2>
                    <div className="SubscriptionContentsContainer-contentMeta">
                        <Link
                            className="SubscriptionContentsContainer-contentOriginalLink"
                            href={this.props.url}
                            target="_blank"
                            rel="noopener"
                        >
                            Original
                        </Link>
                        <span> | </span>
                        <time
                            className="SubscriptionContentsContainer-contentUpdatedTime"
                            dateTime={this.props.updatedDate.toISOString()}
                        >
                            {distanceInWordsToNow(this.props.updatedDate)}
                        </time>
                        {author}
                    </div>
                </header>
                <HTMLContent className="SubscriptionContentsContainer-contentBody">{this.props.body}</HTMLContent>
                <footer className="SubscriptionContentsContainer-contentFooter">
                    <label>Posted: </label>
                    <time
                        className="SubscriptionContentsContainer-contentPostedTime"
                        dateTime={this.props.publishedDate.toISOString()}
                    >
                        {format(this.props.publishedDate, "YYYY-MM-DD mm:ss")}
                    </time>
                    {updatedFooter}
                </footer>
            </div>
        );
    }
}
