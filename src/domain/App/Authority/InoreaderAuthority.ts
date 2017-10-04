// MIT © 2017 azu
import { Entity, Identifier, Serializer } from "ddd-base";

export const InoreaderAuthoritySerializer: Serializer<InoreaderAuthority, InoreaderAuthorityJSON> = {
    fromJSON(json) {
        return new InoreaderAuthority({
            ...json,
            id: new InoreaderAuthorityIdentifier(json.id)
        });
    },
    toJSON(entity) {
        return {
            id: entity.id.toValue(),
            clientId: entity.clientId,
            clientSecret: entity.clientSecret,
            accessTokenUri: entity.accessTokenUri,
            authorizationUri: entity.authorizationUri,
            scopes: entity.scopes,
            state: entity.state
        };
    }
};

export interface InoreaderAuthorityArgs {
    id: InoreaderAuthorityIdentifier;
    clientId: string;
    clientSecret: string;
    accessTokenUri: string;
    authorizationUri: string;
    scopes: string[];
    state: string;
}

export interface InoreaderAuthorityJSON {
    id: string;
    clientId: string;
    clientSecret: string;
    accessTokenUri: string;
    authorizationUri: string;
    scopes: string[];
    state: string;
}

export class InoreaderAuthorityIdentifier extends Identifier<string> {}

export class InoreaderAuthority extends Entity<InoreaderAuthorityIdentifier> {
    id: InoreaderAuthorityIdentifier;
    clientId: string;
    clientSecret: string;
    accessTokenUri: string;
    authorizationUri: string;
    scopes: string[];
    state: string;

    constructor(args: InoreaderAuthorityArgs) {
        super(args.id);
        this.clientId = args.clientId;
        this.clientSecret = args.clientSecret;
        this.accessTokenUri = args.accessTokenUri;
        this.authorizationUri = args.authorizationUri;
        this.scopes = args.scopes;
        this.state = args.state;
    }

    update(args: Partial<InoreaderAuthorityArgs>) {
        const newAuthority = new InoreaderAuthority({
            ...(this as InoreaderAuthorityArgs),
            ...args
        });
        return newAuthority.equals(this) ? this : newAuthority;
    }
}
