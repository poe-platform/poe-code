import { createCipheriv, scryptSync } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { describe, expect, it, vi } from "vitest";
import { SafeFsSecretStore } from "./safe-fs-secret-store.js";

async function setup() {
  const fs = new MemoryFileSystem();
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const store = new SafeFsSecretStore({ fs, filePath: "/credentials/secret.enc", key });
  return { fs, key, store };
}

describe("portable encrypted secrets", () => {
  it("round trips Unicode using encrypted bytes, private permissions and fresh IVs", async () => {
    const { fs, store } = await setup();
    expect(await store.get()).toBeNull();
    await store.set("secret 🔑");
    const first = await fs.readFile("/credentials/secret.enc");
    expect(new TextDecoder().decode(first)).not.toContain("secret");
    expect((await fs.lstat("/credentials/secret.enc")).mode & 0o777).toBe(0o600);
    expect(await store.get()).toBe("secret 🔑");
    await store.set("secret 🔑");
    expect(await fs.readFile("/credentials/secret.enc")).not.toEqual(first);
    await store.delete();
    await store.delete();
    expect(await store.get()).toBeNull();
  });

  it("reads the desktop AES-GCM document format with a host-imported key", async () => {
    const { fs } = await setup();
    const bytes = scryptSync("host:user", "application", 32);
    const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
    const iv = new Uint8Array(12).fill(7);
    const cipher = createCipheriv("aes-256-gcm", bytes, iv);
    const ciphertext = Buffer.concat([cipher.update("desktop secret", "utf8"), cipher.final()]);
    await fs.mkdir("/credentials");
    await fs.writeFile("/credentials/secret.enc", new TextEncoder().encode(JSON.stringify({
      version: 1, iv: Buffer.from(iv).toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"),
    })));
    expect(await new SafeFsSecretStore({ fs, filePath: "/credentials/secret.enc", key }).get()).toBe("desktop secret");
  });

  it("fails closed on tampered documents and wrong keys without modifying the file", async () => {
    const { fs, key, store } = await setup();
    await store.set("secret");
    const other = await setup();
    await expect(new SafeFsSecretStore({ fs, filePath: "/credentials/secret.enc", key: other.key }).get()).rejects.toThrow("Invalid encrypted credential document");
    const bytes = new TextEncoder().encode('{"version":1,"iv":"invalid"}');
    await fs.writeFile("/credentials/secret.enc", bytes);
    await expect(store.get()).rejects.toThrow("Invalid encrypted credential document");
    expect(await fs.readFile("/credentials/secret.enc")).toEqual(bytes);
    expect(key.extractable).toBe(false);
  });

  it("preserves the previous document and cleans owned staging when publication fails", async () => {
    const { fs, store } = await setup();
    await store.set("old");
    vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("publication failed"));
    await expect(store.set("new")).rejects.toThrow("publication failed");
    expect(await store.get()).toBe("old");
    expect((await fs.readdir("/credentials")).map(entry => entry.name)).toEqual(["secret.enc"]);
  });

  it("rejects symbolic links in credential ancestry", async () => {
    const { fs, store } = await setup();
    await fs.mkdir("/other");
    await fs.symlink("/other", "/credentials");
    await expect(store.set("secret")).rejects.toThrow("symbolic link");
    await expect(store.get()).rejects.toThrow("symbolic link");
    await expect(store.delete()).rejects.toThrow("symbolic link");
  });
});
