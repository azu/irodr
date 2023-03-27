// MIT © 2017 azu
import { ValueObject } from "ddd-base";
import type { Enclosure } from "../../../infra/api/StreamContentsResponse";

export class SubscriptionContentBody extends ValueObject<{}> {
    constructor(private body: { enclosures?: Enclosure[]; content: string }) {
        super(body);
    }

    get HTMLString(): string {
        const attachments =
            this.body.enclosures
                ?.map((enclosure) => {
                    if (enclosure.type.startsWith("image/")) {
                        return `<img src="${enclosure.href}" alt="" />`;
                    }
                    return "";
                })
                .join("") ?? "";
        return this.body + (attachments ? `<div>${attachments}</div>` : "");
    }
}
