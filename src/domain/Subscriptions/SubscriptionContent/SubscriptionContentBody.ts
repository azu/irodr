// MIT © 2017 azu
import { ValueObject } from "ddd-base";
import type { Enclosure } from "../../../infra/api/StreamContentsResponse";

export type SubscriptionContentBodyArgs = { enclosures?: Enclosure[]; content: string };

export class SubscriptionContentBody extends ValueObject<{}> {
    constructor(private body: SubscriptionContentBodyArgs) {
        super(body);
    }

    get HTMLString(): string {
        const hasImageInContent = this.body.content.includes("<img");
        if (hasImageInContent) {
            return this.body.content;
        }
        // If enclosures has image, show it
        // But, prevent to show duplicated image in content
        const attachments =
            this.body.enclosures
                ?.map((enclosure) => {
                    if (enclosure.type.startsWith("image/")) {
                        return `<img class="SubscriptionContentBody-enclosure" src="${enclosure.href}" alt="" />`;
                    }
                    return "";
                })
                .join("") ?? "";
        return (
            this.body.content +
            (attachments ? `<div class="SubscriptionContentBody-enclosures">${attachments}</div>` : "")
        );
    }

    toJSON(): SubscriptionContentBodyArgs {
        return {
            content: this.body.content,
            enclosures: this.body.enclosures
        };
    }
}
