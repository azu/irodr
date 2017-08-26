// MIT © 2017 azu
import { NullableBaseRepository } from "ddd-base/lib/NullableBaseRepository";
import { Subscription } from "../../domain/Subscriptions/Subscription";

export class SubscriptionRepository extends NullableBaseRepository<Subscription> {}

export const subscriptionRepository = new SubscriptionRepository();
