// MIT © 2017 azu
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
