import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import {
  EncryptedFileStore,
  type EncryptedFileStoreFileSystem
} from "./encrypted-file-store.js";

interface StatFileSystem extends EncryptedFileStoreFileSystem {
  stat(path: string): Promise<{ mode: number }>;
}

function createMemFs(): StatFileSystem {
  const volume = new Volume();
  return createFsFromVolume(volume).promises as unknown as StatFileSystem;
}

const TEST_SALT = "test-app:encrypted-store:v1";

describe("EncryptedFileStore", () => {
  it("encrypts values with AES-256-GCM and uses a random IV per write", async () => {
    const fs = createMemFs();
    const filePath = "/home/test/.app/credentials.enc";
    const store = new EncryptedFileStore({
      fs,
      filePath,
      salt: TEST_SALT,
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await store.set("secret-value");
    const firstPayload = await fs.readFile(filePath, "utf8");
    const firstDocument = JSON.parse(firstPayload) as {
      version: number;
      iv: string;
      authTag: string;
      ciphertext: string;
    };

    expect(firstPayload).not.toContain("secret-value");
    expect(firstDocument.version).toBe(1);
    expect(Buffer.from(firstDocument.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(firstDocument.authTag, "base64")).toHaveLength(16);
    expect(firstDocument.ciphertext.length).toBeGreaterThan(0);

    await store.set("secret-value");
    const secondPayload = await fs.readFile(filePath, "utf8");

    expect(secondPayload).not.toBe(firstPayload);
    await expect(store.get()).resolves.toBe("secret-value");
  });

  it("derives machine-bound key using hostname and username", async () => {
    const fs = createMemFs();
    const filePath = "/home/test/.app/credentials.enc";
    const writerStore = new EncryptedFileStore({
      fs,
      filePath,
      salt: TEST_SALT,
      getMachineIdentity: () => ({ hostname: "writer-host", username: "writer-user" })
    });
    const readerStore = new EncryptedFileStore({
      fs,
      filePath,
      salt: TEST_SALT,
      getMachineIdentity: () => ({ hostname: "reader-host", username: "writer-user" })
    });

    await writerStore.set("machine-bound-secret");

    await expect(readerStore.get()).resolves.toBeNull();
  });

  it("uses configurable default directory and file name", async () => {
    const fs = createMemFs();
    const store = new EncryptedFileStore({
      fs,
      salt: TEST_SALT,
      defaultDirectory: ".my-app",
      defaultFileName: "secret.enc",
      getHomeDirectory: () => "/home/custom",
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await store.set("default-path-value");

    await expect(
      fs.readFile("/home/custom/.my-app/secret.enc", "utf8")
    ).resolves.toContain("ciphertext");
    await expect(store.get()).resolves.toBe("default-path-value");
  });

  it("sets 0600 permissions when writing credentials", async () => {
    const fs = createMemFs();
    const filePath = "/home/test/.app/credentials.enc";
    const store = new EncryptedFileStore({
      fs,
      filePath,
      salt: TEST_SALT,
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await store.set("permissioned-value");

    const stats = await fs.stat(filePath);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it("returns null instead of throwing when decryption fails", async () => {
    const fs = createMemFs();
    const filePath = "/home/test/.app/credentials.enc";
    const store = new EncryptedFileStore({
      fs,
      filePath,
      salt: TEST_SALT,
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await fs.mkdir("/home/test/.app", { recursive: true });
    await fs.writeFile(
      filePath,
      "{\"version\":1,\"iv\":\"aQ==\",\"authTag\":\"Yg==\",\"ciphertext\":\"Yw==\"}",
      { encoding: "utf8" }
    );

    await expect(store.get()).resolves.toBeNull();
  });

  it("deletes encrypted file", async () => {
    const fs = createMemFs();
    const filePath = "/home/test/.app/credentials.enc";
    const store = new EncryptedFileStore({
      fs,
      filePath,
      salt: TEST_SALT,
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await store.set("delete-me");

    await store.delete();

    await expect(store.get()).resolves.toBeNull();
    await expect(fs.readFile(filePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
