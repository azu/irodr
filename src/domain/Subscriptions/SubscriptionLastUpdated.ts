import { ValueObject } from "ddd-base";

export class SubscriptionLastUpdated extends ValueObject {
    date: Date;

    constructor(date: Date) {
        super();
        this.date = date;
    }
}
