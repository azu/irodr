// MIT © 2017 azu

import { Serializer } from "ddd-base";

export const TimeStampSerializer: Serializer<TimeStamp, TimeStampJSON> = {
    fromJSON(json) {
        return new TimeStamp(json);
    },
    toJSON(entity) {
        return entity.second;
    }
};
// unix-time
export type TimeStampJSON = number;

export class TimeStamp {
    value: number;

    static createTimeStampFromSecond(second: number) {
        return new TimeStamp(second);
    }

    constructor(second: number) {
        this.value = second;
    }

    get second() {
        return this.value;
    }
}
