// MIT © 2017 azu
import { createSubscriptionsFromResponses } from "../SubscriptionFactory";
import * as assert from "assert";
import { Subscription } from "../Subscription";

describe("Subscription", () => {
    it("factory return a instance", () => {
        const subscriptions = createSubscriptionsFromResponses(
            require("../__fixtures__/subbscription.json"),
            require("../__fixtures__/unread.json")
        );
        subscriptions.forEach(subscription => {
            assert.ok(subscription instanceof Subscription);
        });
    });
});
