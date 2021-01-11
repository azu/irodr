// MIT © 2017 azu
import { ValueObject } from "ddd-base";

export class SubscriptionContentBody extends ValueObject<{}> {
    constructor(private body: string) {
        super(body);
    }

    get HTMLString(): string {
        return this.body;
    }
}
