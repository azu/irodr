// MIT © 2017 azu

import { Serializer, ValueObject } from "ddd-base";

export const TimeStampSerializer: Serializer<TimeStamp, TimeStampJSON> = {
    fromJSON(json) {
        return TimeStamp.createTimeStampFromMillisecond(json);
    },
    toJSON(entity) {
        return entity.millSecond;
    }
};
// unix-time
export type TimeStampJSON = number;
export type TimeStampOperator = "==" | ">=" | "<=" | ">" | "<";

export class TimeStamp extends ValueObject<{}> {
    // millsecond
    value: number;
    readonly date: Date;

    static createTimeStampFromSecond(second: number) {
        return new TimeStamp(second * 1000);
    }

    static createTimeStampFromMillisecond(millisecond: number) {
        return new TimeStamp(millisecond);
    }

    static createTimeStampFromMicrosecond(microsecond: number) {
        return new TimeStamp(microsecond / 1000);
    }

    static now() {
        return new TimeStamp(Date.now());
    }

    constructor(millisecond: number) {
        super(millisecond);
        this.value = millisecond;
        this.date = new Date(this.value);
    }

    compare(operator: TimeStampOperator, other: TimeStamp): boolean {
        switch (operator) {
            case "==":
                return this.millSecond === other.millSecond;
            case ">=":
                return this.millSecond >= other.millSecond;
            case "<=":
                return this.millSecond <= other.millSecond;
            case "<":
                return this.millSecond < other.millSecond;
            case ">":
                return this.millSecond > other.millSecond;
            default:
                throw new Error(`operator(${operator}} not supported`);
        }
    }

    get isoString(): string {
        return this.date.toISOString();
    }

    get second() {
        return this.value / 1000;
    }

    get millSecond() {
        return this.value;
    }
}
