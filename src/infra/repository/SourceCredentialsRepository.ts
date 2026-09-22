import { createStorageInstance } from "./Storage";

interface SavedCredential {
    version: 2;
    token: string;
}

export interface CredentialStorage {
    getItem<T>(key: string): Promise<T | null>;
    setItem<T>(key: string, value: T): Promise<T>;
    removeItem(key: string): Promise<void>;
}

/** Browser-local, unencrypted credentials, separate from shared source/item data. */
export class SourceCredentialsRepository {
    constructor(
        private readonly storage: CredentialStorage = createStorageInstance({ name: "irodr-source-credentials" })
    ) {}

    private key(sourceId: string): string {
        return `credential:${encodeURIComponent(sourceId)}`;
    }

    async save(sourceId: string, token: string): Promise<void> {
        if (!token.trim()) {
            throw new Error("A nonempty token is required");
        }
        await this.storage.setItem<SavedCredential>(this.key(sourceId), { version: 2, token: token.trim() });
    }

    async load(sourceId: string): Promise<string | undefined> {
        const saved = await this.storage.getItem<SavedCredential>(this.key(sourceId));
        // Old encrypted entries cannot be restored without their passphrase.
        // Ask for the PAT once more; saving it replaces the old entry.
        return saved?.version === 2 && typeof saved.token === "string" && saved.token.trim()
            ? saved.token.trim()
            : undefined;
    }

    async has(sourceId: string): Promise<boolean> {
        return (await this.load(sourceId)) !== undefined;
    }

    async remove(sourceId: string): Promise<void> {
        await this.storage.removeItem(this.key(sourceId));
    }
}

export const sourceCredentialsRepository = new SourceCredentialsRepository();
