import { SourceCredentialsRepository } from "../SourceCredentialsRepository";
import { createStorageInstance, storageManger } from "../Storage";

describe("SourceCredentialsRepository", () => {
    let storage: LocalForage;
    let vault: SourceCredentialsRepository;

    beforeAll(async () => {
        await storageManger.useMemoryDriver();
    });

    beforeEach(async () => {
        storage = createStorageInstance({ name: "source-credentials-test" });
        await storage.clear();
        vault = new SourceCredentialsRepository(storage);
    });

    it("stores a browser-local token, reloads and removes it without a passphrase", async () => {
        expect(await vault.has("feed")).toBe(false);
        await vault.save("feed", "  test-only-token  ");
        expect(await vault.has("feed")).toBe(true);
        expect(await storage.getItem("credential:feed")).toEqual({ version: 2, token: "test-only-token" });
        const reloaded = new SourceCredentialsRepository(storage);
        expect(await reloaded.load("feed")).toBe("test-only-token");
        await reloaded.remove("feed");
        expect(await vault.has("feed")).toBe(false);
        expect(await vault.load("feed")).toBeUndefined();
    });

    it("rejects blank tokens and isolates sources", async () => {
        await expect(vault.save("feed", "  ")).rejects.toThrow("nonempty");
        await vault.save("feed", "test-only-token");
        expect(await vault.load("other")).toBeUndefined();
    });

    it("does not treat old encrypted entries as usable tokens and replaces them on save", async () => {
        await storage.setItem("credential:feed", { version: 1, salt: [], iv: [], ciphertext: [] });
        expect(await vault.load("feed")).toBeUndefined();
        expect(await vault.has("feed")).toBe(false);
        await vault.save("feed", "test-only-token");
        expect(await vault.load("feed")).toBe("test-only-token");
    });
});
