import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import {
  EncryptedFileAuthStore,
  type EncryptedFileAuthStoreFileSystem
} from "./encrypted-file-auth-store.js";

interface StatFileSystem extends EncryptedFileAuthStoreFileSystem {
  stat(path: string): Promise<{ mode: number }>;
}

function createMemFs(): StatFileSystem {
  const volume = new Volume();
  return createFsFromVolume(volume).promises as unknown as StatFileSystem;
}

describe("EncryptedFileAuthStore", () => {
  it("encrypts API keys with AES-256-GCM and uses a random IV per write", async () => {
    const fs = createMemFs();
    const filePath = "/home/test/.poe-code/credentials.enc";
    const store = new EncryptedFileAuthStore({
      fs,
      filePath,
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await store.setApiKey("poe-secret-key");
    const firstPayload = await fs.readFile(filePath, "utf8");
    const firstDocument = JSON.parse(firstPayload) as {
      version: number;
      iv: string;
      authTag: string;
      ciphertext: string;
    };

    expect(firstPayload).not.toContain("poe-secret-key");
    expect(firstDocument.version).toBe(1);
    expect(Buffer.from(firstDocument.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(firstDocument.authTag, "base64")).toHaveLength(16);
    expect(firstDocument.ciphertext.length).toBeGreaterThan(0);

    await store.setApiKey("poe-secret-key");
    const secondPayload = await fs.readFile(filePath, "utf8");

    expect(secondPayload).not.toBe(firstPayload);
    await expect(store.getApiKey()).resolves.toBe("poe-secret-key");
  });

  it("derives machine-bound key using hostname and username", async () => {
    const fs = createMemFs();
    const filePath = "/home/test/.poe-code/credentials.enc";
    const writerStore = new EncryptedFileAuthStore({
      fs,
      filePath,
      getMachineIdentity: () => ({ hostname: "writer-host", username: "writer-user" })
    });
    const readerStore = new EncryptedFileAuthStore({
      fs,
      filePath,
      getMachineIdentity: () => ({ hostname: "reader-host", username: "writer-user" })
    });

    await writerStore.setApiKey("machine-bound-key");

    await expect(readerStore.getApiKey()).resolves.toBeNull();
  });

  it("stores encrypted key in ~/.poe-code/credentials.enc by default", async () => {
    const fs = createMemFs();
    const store = new EncryptedFileAuthStore({
      fs,
      getHomeDirectory: () => "/home/custom",
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await store.setApiKey("default-path-key");

    await expect(
      fs.readFile("/home/custom/.poe-code/credentials.enc", "utf8")
    ).resolves.toContain("ciphertext");
    await expect(store.getApiKey()).resolves.toBe("default-path-key");
  });

  it("sets 0600 permissions when writing credentials", async () => {
    const fs = createMemFs();
    const filePath = "/home/test/.poe-code/credentials.enc";
    const store = new EncryptedFileAuthStore({
      fs,
      filePath,
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await store.setApiKey("permissioned-key");

    const stats = await fs.stat(filePath);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it("returns null instead of throwing when decryption fails", async () => {
    const fs = createMemFs();
    const filePath = "/home/test/.poe-code/credentials.enc";
    const store = new EncryptedFileAuthStore({
      fs,
      filePath,
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await fs.mkdir("/home/test/.poe-code", { recursive: true });
    await fs.writeFile(
      filePath,
      "{\"version\":1,\"iv\":\"aQ==\",\"authTag\":\"Yg==\",\"ciphertext\":\"Yw==\"}",
      {
        encoding: "utf8"
      }
    );

    await expect(store.getApiKey()).resolves.toBeNull();
  });

  it("deletes encrypted credentials file", async () => {
    const fs = createMemFs();
    const filePath = "/home/test/.poe-code/credentials.enc";
    const store = new EncryptedFileAuthStore({
      fs,
      filePath,
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await store.setApiKey("delete-me");

    await store.deleteApiKey();

    await expect(store.getApiKey()).resolves.toBeNull();
    await expect(fs.readFile(filePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
