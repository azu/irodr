// MIT © 2017 azu
import { UseCase } from "almin";
import { InoreaderAPI } from "../../infra/api/InoreaderAPI";

export const createGoToOAuthPageUseCase = () => {
    return new GoToOAuthPageUseCase();
};

export class GoToOAuthPageUseCase extends UseCase {
    execute() {
        const client = new InoreaderAPI();
        location.href = client.getAuthorizeUrl();
    }
}
