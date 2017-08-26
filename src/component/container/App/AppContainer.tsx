import * as React from "react";
import "./AppContainer.css";
import { appStoreGroup } from "./AppStoreGroup";
import { BaseContainer } from "../BaseContainer";
import { createUpdateSubscriptionsUseCase } from "../../../use-case/subscription/UpdateSubscriptionsUseCase";

export class AppContainer extends BaseContainer<typeof appStoreGroup.state, {}> {
    fetchList = () => {
        this.useCase(createUpdateSubscriptionsUseCase()).executor(useCase => useCase.execute());
    };

    render() {
        return (
            <div className="App">
                <button onClick={this.fetchList}>Fetch</button>
            </div>
        );
    }
}
