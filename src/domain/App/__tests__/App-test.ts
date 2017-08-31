// MIT © 2017 azu
import { createApp } from "../AppFactory";
import { App } from "../App";
import * as assert from "assert";

describe("App", () => {
    it("return instance", () => {
        const app = createApp();
        assert.ok(app instanceof App);
    });
});
