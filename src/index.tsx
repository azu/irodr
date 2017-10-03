import * as React from "react";
import * as ReactDOM from "react-dom";
import { AppContainer } from "./component/container/App/AppContainer";
// import registerServiceWorker from "./registerServiceWorker";
import { InoreaderAPI } from "./infra/api/InoreaderAPI";
import { Context, Dispatcher } from "almin";
import { appStoreGroup } from "./component/container/App/AppStoreGroup";
import { appLocator } from "./AppLocator";
import AlminReactContainer from "almin-react-container";
import { createBootSubscriptionUseCase } from "./use-case/subscription/BootSubscriptionUseCase";
import { createUpdateSubscriptionsUseCase } from "./use-case/subscription/UpdateSubscriptionsUseCase";
import { repositoryContainer } from "./infra/repository/RepositoryContainer";
import { InoreaderAuthority, InoreaderAuthorityIdentifier } from "./domain/App/Authority/InoreaderAuthority";
import { createSaveInoreaderTokenUseCase } from "./use-case/inoreader/SaveInoreaderTokenUseCase";
import { createTestInoreaderAuthUseCase } from "./use-case/inoreader/TestInoreaderAuthUseCase";
import { ShowAuthorizePanelUseCase } from "./component/container/App/Panel/use-case/ToggleAuthorizePanelUseCase";

// require all css files
function requireAll(r: any) {
    r.keys().forEach(r);
}

requireAll((require as any).context("./", true, /\.css$/));

(window as any).irodr = {
    debugGetRequest(api: string) {
        const client = new InoreaderAPI(
            new InoreaderAuthority({
                id: new InoreaderAuthorityIdentifier(process.env.REACT_APP_INOREADER_CLIENT_ID!),
                clientId: process.env.REACT_APP_INOREADER_CLIENT_ID!,
                clientSecret: process.env.REACT_APP_INOREADER_CLIENT_KEY!,
                accessTokenUri: process.env.REACT_APP_INOREADER_ACCESS_TOKEN_URL!,
                authorizationUri: "https://www.inoreader.com/oauth2/auth",
                scopes: ["read", "write"],
                state: "inoreader"
            })
        );
        client.getRequest(api).then(response => console.log(response), error => console.error(error));
    },
    appStoreGroup,
    get repository() {
        return repositoryContainer.get();
    }
};

const context = new Context({
    store: appStoreGroup,
    dispatcher: new Dispatcher(),
    options: {
        strict: true,
        performanceProfile: /[?&]almin_perf\b/.test(location.href)
    }
});
appLocator.context = context;
if (process.env.NODE_ENV !== "production") {
    console.clear();
    console.info("env", process.env);
    const { AlminLogger } = require("almin-logger");
    const logger = new AlminLogger();
    logger.startLogging(context);
}
const App = AlminReactContainer.create(AppContainer, context);
// registerServiceWorker();
const bootPromise = location.search.includes("?code")
    ? context
          .useCase(createSaveInoreaderTokenUseCase())
          .executor(useCase => useCase.execute(location.href))
          .then(token => {
              console.log(token);
              history.replaceState("", "", location.pathname);
          })
    : Promise.resolve();
bootPromise
    .then(() => {
        return context
            .useCase(createBootSubscriptionUseCase())
            .executor(useCase => useCase.execute(location.href))
            .then(() => {
                ReactDOM.render(<App />, document.getElementById("root") as HTMLElement);
            })
            .then(() => {
                return context
                    .useCase(createTestInoreaderAuthUseCase())
                    .executor(useCase => useCase.execute())
                    .catch(async error => {
                        await context.useCase(new ShowAuthorizePanelUseCase()).executor(useCase => useCase.execute());
                        return Promise.reject(error);
                    });
            })
            .then(() => {
                return context.useCase(createUpdateSubscriptionsUseCase()).execute();
            });
    })
    .catch(error => {
        console.error(error);
    });
