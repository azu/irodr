// MIT © 2017 azu
import { BaseContainer } from "../../../BaseContainer";
import { TimeScheduler } from "../../../../../infra/time-sheduler/TimeScheduler";
import { createUpdateSubscriptionsUseCase } from "../../../../../use-case/subscription/UpdateSubscriptionsUseCase";
import { AppPreferences } from "../../../../../domain/App/Preferences/AppPreferences";

const debug = require("debug")("irodr:ObserverContainer");

export interface ObserverContainerProps {
    appPreferences: AppPreferences;
}

export class ObserverContainer extends BaseContainer<ObserverContainerProps, {}> {
    timeScheduler: TimeScheduler;

    constructor(props: ObserverContainerProps) {
        super(props);
        const AUTO_UPDATE_INTERVAL = 1000 * this.props.appPreferences.autoRefreshSubscriptionSec;
        this.timeScheduler = new TimeScheduler(this.onIntervalWork, AUTO_UPDATE_INTERVAL);
    }

    onIntervalWork = () => {
        debug("try auto-reload");
        this.useCase(createUpdateSubscriptionsUseCase()).execute();
    };

    componentDidMount() {
        this.timeScheduler.start();
    }

    componentWillUnmount() {
        this.timeScheduler.stop();
    }

    render() {
        return null;
    }
}
