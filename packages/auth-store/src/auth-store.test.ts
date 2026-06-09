import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { createSecretStore } from "./index.js";
import type { EncryptedFileStoreFileSystem } from "./encrypted-file-store.js";
import {
  EncryptedFileStore,
} from "./encrypted-file-store.js";
import { KeychainStore } from "./keychain-store.js";

// --- createSecretStore ---

function createMemFs(): EncryptedFileStoreFileSystem {
  const volume = new Volume();
  return createFsFromVolume(volume).promises as unknown as EncryptedFileStoreFileSystem;
}

function createKeychainCommandRunner() {
  return vi.fn(async (_command: string, args: string[]) => {
    if (args[0] === "find-generic-password") {
      return {
        stdout: "keychain-secret\n",
        stderr: "",
        exitCode: 0
      };
    }

    return {
      stdout: "",
      stderr: "",
      exitCode: 0
    };
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("createSecretStore", () => {
  it("creates file backend store by default", async () => {
    const filePath = "/home/test/.app/credentials.enc";
    const fs = createMemFs();
    const result = createSecretStore({
      fileStore: {
        fs,
        filePath,
        salt: "test-app:store:v1",
        getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
      }
    });

    expect(result.backend).toBe("file");
    expect(await result.store.get()).toBeNull();

    await result.store.set("test-secret");
    expect(await result.store.get()).toBe("test-secret");
    expect(await fs.readFile(filePath, "utf8")).not.toContain("test-secret");

    await result.store.delete();
    expect(await result.store.get()).toBeNull();
  });

  it("uses file backend when env var is set to file", async () => {
    const filePath = "/home/test/.app/credentials.enc";
    const fs = createMemFs();
    const result = createSecretStore({
      backendEnvVar: "MY_AUTH_BACKEND",
      env: { MY_AUTH_BACKEND: "file" },
      platform: "linux",
      fileStore: {
        fs,
        filePath,
        salt: "test-app:store:v1",
        getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
      }
    });

    expect(result.backend).toBe("file");
    await result.store.set("test-secret");
    expect(await result.store.get()).toBe("test-secret");
  });

  it("uses keychain backend when env var is set to keychain on macOS", async () => {
    const runCommand = createKeychainCommandRunner();

    const result = createSecretStore({
      backendEnvVar: "MY_AUTH_BACKEND",
      env: { MY_AUTH_BACKEND: "keychain" },
      platform: "darwin",
      keychainStore: {
        runCommand,
        service: "my-app",
        account: "secret"
      }
    });

    expect(result.backend).toBe("keychain");
    await result.store.set("keychain-secret");
    expect(await result.store.get()).toBe("keychain-secret");

    expect(runCommand).toHaveBeenCalledWith("security", [
      "add-generic-password",
      "-s",
      "my-app",
      "-a",
      "secret",
      "-U",
      "-w"
    ], { stdin: "keychain-secret" });
  });

  it("ignores inherited backend environment values", async () => {
    const filePath = "/home/test/.app/credentials.enc";
    const fs = createMemFs();

    await withObjectPrototypeProperties({ INHERITED_AUTH_BACKEND: "keychain" }, async () => {
      const result = createSecretStore({
        backendEnvVar: "INHERITED_AUTH_BACKEND",
        env: {},
        platform: "linux",
        fileStore: {
          fs,
          filePath,
          salt: "test-app:store:v1",
          getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
        }
      });

      expect(result.backend).toBe("file");
      await result.store.set("test-secret");
      expect(await result.store.get()).toBe("test-secret");
    });
  });

  it("throws when keychain backend is requested on non-macOS", () => {
    expect(() => {
      createSecretStore({
        backend: "keychain",
        platform: "linux",
        keychainStore: {
          service: "my-app",
          account: "secret"
        }
      });
    }).toThrowError(
      "Keychain backend is only supported on macOS. Current platform: linux"
    );
  });

  it("reads backend from process.env using custom env var", async () => {
    vi.stubEnv("CUSTOM_BACKEND", "keychain");
    const runCommand = createKeychainCommandRunner();

    const result = createSecretStore({
      backendEnvVar: "CUSTOM_BACKEND",
      platform: "darwin",
      keychainStore: {
        runCommand,
        service: "my-app",
        account: "secret"
      }
    });

    expect(result.backend).toBe("keychain");
  });

  it("rejects unsupported backend environment values", () => {
    expect(() => createSecretStore({
      backendEnvVar: "MY_AUTH_BACKEND",
      env: { MY_AUTH_BACKEND: "keychian" },
      fileStore: { salt: "unused" }
    })).toThrow("Unsupported auth store backend: keychian");
  });
});

// --- EncryptedFileStore ---

interface StatFileSystem extends EncryptedFileStoreFileSystem {
  stat(path: string): Promise<{ mode: number }>;
}

function createStatMemFs(): StatFileSystem {
  const volume = new Volume();
  return createFsFromVolume(volume).promises as unknown as StatFileSystem;
}

const ENCRYPTED_STORE_SALT = "test-app:encrypted-store:v1";

describe("EncryptedFileStore", () => {
  it("encrypts values with AES-256-GCM and uses a random IV per write", async () => {
    const fs = createStatMemFs();
    const filePath = "/home/test/.app/credentials.enc";
    const store = new EncryptedFileStore({
      fs,
      filePath,
      salt: ENCRYPTED_STORE_SALT,
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

  it("ignores inherited encrypted document fields", async () => {
    const fs = createStatMemFs();
    const filePath = "/home/test/.app/credentials.enc";
    const store = new EncryptedFileStore({
      fs,
      filePath,
      salt: ENCRYPTED_STORE_SALT,
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await store.set("secret-value");
    const encryptedDocument = JSON.parse(
      await fs.readFile(filePath, "utf8")
    ) as Record<string, unknown>;
    await fs.writeFile(filePath, "{}", { encoding: "utf8" });

    await withObjectPrototypeProperties(encryptedDocument, async () => {
      await expect(store.get()).resolves.toBeNull();
    });
  });

  it("derives machine-bound key using hostname and username", async () => {
    const fs = createStatMemFs();
    const filePath = "/home/test/.app/credentials.enc";
    const writerStore = new EncryptedFileStore({
      fs,
      filePath,
      salt: ENCRYPTED_STORE_SALT,
      getMachineIdentity: () => ({ hostname: "writer-host", username: "writer-user" })
    });
    const readerStore = new EncryptedFileStore({
      fs,
      filePath,
      salt: ENCRYPTED_STORE_SALT,
      getMachineIdentity: () => ({ hostname: "reader-host", username: "writer-user" })
    });

    await writerStore.set("machine-bound-secret");

    await expect(readerStore.get()).resolves.toBeNull();
  });

  it("uses configurable default directory and file name", async () => {
    const fs = createStatMemFs();
    const store = new EncryptedFileStore({
      fs,
      salt: ENCRYPTED_STORE_SALT,
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
    const fs = createStatMemFs();
    const filePath = "/home/test/.app/credentials.enc";
    const store = new EncryptedFileStore({
      fs,
      filePath,
      salt: ENCRYPTED_STORE_SALT,
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await store.set("permissioned-value");

    const stats = await fs.stat(filePath);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it("rejects a symlinked credential file before overwriting its target", async () => {
    const fs = createStatMemFs();
    const filePath = "/home/test/.app/credentials.enc";
    await fs.mkdir("/home/test/.app", { recursive: true });
    await fs.writeFile("/outside.enc", "sentinel", { encoding: "utf8" });
    await (fs as unknown as { symlink(target: string, path: string): Promise<void> }).symlink(
      "/outside.enc",
      filePath
    );
    const store = new EncryptedFileStore({
      fs,
      filePath,
      salt: ENCRYPTED_STORE_SALT,
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await expect(store.set("secret-value")).rejects.toThrow(/symbolic link/i);
    await expect(fs.readFile("/outside.enc", "utf8")).resolves.toBe("sentinel");
  });

  it("rejects reads, writes, and deletes through a symlinked state directory", async () => {
    const fs = createStatMemFs();
    await fs.mkdir("/home/test", { recursive: true });
    await fs.mkdir("/outside", { recursive: true });
    await (fs as unknown as { symlink(target: string, path: string): Promise<void> }).symlink(
      "/outside",
      "/home/test/.app"
    );
    const store = new EncryptedFileStore({
      fs,
      filePath: "/home/test/.app/credentials.enc",
      salt: ENCRYPTED_STORE_SALT,
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await expect(store.set("secret-value")).rejects.toThrow(/symbolic link/i);
    await expect(store.get()).rejects.toThrow(/symbolic link/i);
    await expect(store.delete()).rejects.toThrow(/symbolic link/i);
    await expect(fs.readFile("/outside/credentials.enc", "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects credentials beneath a symlinked default directory ancestor", async () => {
    const fs = createStatMemFs();
    await fs.mkdir("/home/test", { recursive: true });
    await fs.mkdir("/outside", { recursive: true });
    await (fs as unknown as { symlink(target: string, path: string): Promise<void> }).symlink(
      "/outside",
      "/home/test/.poe-code"
    );
    const store = new EncryptedFileStore({
      fs,
      defaultDirectory: ".poe-code/mcp-oauth",
      defaultFileName: "credentials.enc",
      salt: ENCRYPTED_STORE_SALT,
      getHomeDirectory: () => "/home/test",
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await expect(store.set("secret-value")).rejects.toThrow(/symbolic link/i);
    await expect(store.get()).rejects.toThrow(/symbolic link/i);
    await expect(store.delete()).rejects.toThrow(/symbolic link/i);
    await expect(fs.readFile("/outside/mcp-oauth/credentials.enc", "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows credentials beneath a symlinked operating-system path ancestor", async () => {
    const fs = createStatMemFs();
    await fs.mkdir("/private/var/tmp/home/.app", { recursive: true });
    await (fs as unknown as { symlink(target: string, path: string): Promise<void> }).symlink(
      "/private/var",
      "/var"
    );
    const store = new EncryptedFileStore({
      fs,
      filePath: "/var/tmp/home/.app/credentials.enc",
      salt: ENCRYPTED_STORE_SALT,
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await store.set("secret-value");

    await expect(store.get()).resolves.toBe("secret-value");
  });

  it("removes a new credential when permission hardening fails", async () => {
    let storedContent: string | undefined;
    const fs: EncryptedFileStoreFileSystem = {
      readFile: vi.fn(async () => {
        if (storedContent === undefined) {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
        return storedContent;
      }),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      lstat: vi.fn(async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }),
      writeFile: vi.fn(async (_filePath, data) => { storedContent = String(data); }),
      chmod: vi.fn(async () => { throw new Error("chmod denied"); }),
      unlink: vi.fn(async () => { storedContent = undefined; })
    };
    const store = new EncryptedFileStore({
      fs,
      filePath: "/credentials.enc",
      salt: ENCRYPTED_STORE_SALT,
      getMachineIdentity: () => ({ hostname: "host", username: "user" })
    });

    await expect(store.set("secret")).rejects.toThrow("chmod denied");
    await expect(store.get()).resolves.toBeNull();
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringMatching(/^\/credentials\.enc\..+\.tmp$/));
  });

  it("does not follow or remove a colliding temporary credential symlink", async () => {
    const baseFs = createStatMemFs();
    const filePath = "/home/test/.app/credentials.enc";
    await baseFs.mkdir(path.dirname(filePath), { recursive: true });
    await baseFs.mkdir("/outside", { recursive: true });
    await baseFs.writeFile("/outside/credentials.tmp", "outside-state\n", { encoding: "utf8" });
    let temporaryPath: string | undefined;
    const fs: EncryptedFileStoreFileSystem = {
      ...baseFs,
      async writeFile(targetPath, data, options) {
        if (targetPath.startsWith(`${filePath}.`) && targetPath.endsWith(".tmp")) {
          temporaryPath = targetPath;
          await (baseFs as unknown as { symlink(target: string, path: string): Promise<void> }).symlink(
            "/outside/credentials.tmp",
            targetPath
          );
        }

        await baseFs.writeFile(targetPath, data, options);
      }
    };
    const store = new EncryptedFileStore({
      fs,
      filePath,
      salt: ENCRYPTED_STORE_SALT,
      getMachineIdentity: () => ({ hostname: "host", username: "user" })
    });

    await expect(store.set("secret")).rejects.toThrow();

    expect(temporaryPath).toBeDefined();
    await expect(baseFs.readFile("/outside/credentials.tmp", "utf8")).resolves.toBe("outside-state\n");
    expect((await baseFs.lstat(temporaryPath as string)).isSymbolicLink()).toBe(true);
    await expect(baseFs.readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves the previous credential when a rotation write fails", async () => {
    const baseFs = createStatMemFs();
    const filePath = "/home/test/.app/credentials.enc";
    const common = {
      filePath,
      salt: ENCRYPTED_STORE_SALT,
      getMachineIdentity: () => ({ hostname: "host", username: "user" }),
      getRandomBytes: () => Buffer.alloc(12, 1)
    };
    const original = new EncryptedFileStore({ ...common, fs: baseFs });

    await original.set("old-secret");

    let temporaryPath: string | undefined;
    const fs: EncryptedFileStoreFileSystem = {
      ...baseFs,
      async writeFile(targetPath, _data, options) {
        temporaryPath = targetPath;
        await baseFs.writeFile(targetPath, "{", options);
        throw new Error("credential disk full");
      }
    };
    const rotating = new EncryptedFileStore({ ...common, fs });

    await expect(rotating.set("new-secret")).rejects.toThrow("credential disk full");
    await expect(original.get()).resolves.toBe("old-secret");
    expect(temporaryPath?.startsWith(`${filePath}.`)).toBe(true);
    expect(temporaryPath?.endsWith(".tmp")).toBe(true);
    await expect(baseFs.readFile(temporaryPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not share cached keys between ambiguous identity tuples", async () => {
    const fs = createStatMemFs();
    const filePath = "/home/test/.app/collision.enc";
    const writer = new EncryptedFileStore({
      fs,
      filePath,
      salt: "d",
      getMachineIdentity: () => ({ hostname: "a", username: "b:c" })
    });
    const reader = new EncryptedFileStore({
      fs,
      filePath,
      salt: "c:d",
      getMachineIdentity: () => ({ hostname: "a", username: "b" })
    });

    await writer.set("credential");

    await expect(reader.get()).resolves.toBeNull();
  });

  it("retries encryption-key derivation after a transient failure", async () => {
    const fs = createStatMemFs();
    const getMachineIdentity = vi.fn()
      .mockRejectedValueOnce(new Error("identity unavailable"))
      .mockResolvedValue({ hostname: "host", username: "user" });
    const store = new EncryptedFileStore({
      fs,
      filePath: "/home/test/.app/retry.enc",
      salt: "retry-salt",
      getMachineIdentity
    });

    await expect(store.set("credential")).rejects.toThrow("identity unavailable");
    await expect(store.set("credential")).resolves.toBeUndefined();
    expect(getMachineIdentity).toHaveBeenCalledTimes(2);
  });

  it("returns null instead of throwing when decryption fails", async () => {
    const fs = createStatMemFs();
    const filePath = "/home/test/.app/credentials.enc";
    const store = new EncryptedFileStore({
      fs,
      filePath,
      salt: ENCRYPTED_STORE_SALT,
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

  it("does not treat inherited filesystem error codes as missing files", async () => {
    const fs: EncryptedFileStoreFileSystem = {
      readFile: vi.fn(async () => {
        throw new Error("read permission denied");
      }),
      writeFile: vi.fn(async () => undefined),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      lstat: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }),
      unlink: vi.fn(async () => undefined),
      chmod: vi.fn(async () => undefined)
    };
    const store = new EncryptedFileStore({
      fs,
      filePath: "/home/test/.app/credentials.enc",
      salt: ENCRYPTED_STORE_SALT,
      getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
    });

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(store.get()).rejects.toThrow("read permission denied");
    });
  });

  it("deletes encrypted file", async () => {
    const fs = createStatMemFs();
    const filePath = "/home/test/.app/credentials.enc";
    const store = new EncryptedFileStore({
      fs,
      filePath,
      salt: ENCRYPTED_STORE_SALT,
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

// --- KeychainStore ---

describe("KeychainStore", () => {
  it("stores secret with security add-generic-password", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const store = new KeychainStore({ runCommand, service: "my-app", account: "secret" });

    await store.set("my-secret-value");

    expect(runCommand).toHaveBeenCalledWith("security", [
      "add-generic-password",
      "-s",
      "my-app",
      "-a",
      "secret",
      "-U",
      "-w"
    ], { stdin: "my-secret-value" });
    expect(runCommand.mock.calls[0]?.[1]).not.toContain("my-secret-value");
  });

  it("reads secret with security find-generic-password", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "my-secret-value\n",
      stderr: "",
      exitCode: 0
    }));
    const store = new KeychainStore({ runCommand, service: "my-app", account: "secret" });

    await expect(store.get()).resolves.toBe("my-secret-value");
    expect(runCommand).toHaveBeenCalledWith("security", [
      "find-generic-password",
      "-s",
      "my-app",
      "-a",
      "secret",
      "-w"
    ]);
  });

  it("does not read inherited keychain command result fields", async () => {
    const inheritedResult = Object.create({
      stdout: "polluted-secret\n",
      stderr: "",
      exitCode: 0
    }) as { stdout: string; stderr: string; exitCode: number };
    const runCommand = vi.fn(async () => inheritedResult);
    const store = new KeychainStore({ runCommand, service: "my-app", account: "secret" });

    await expect(store.get()).rejects.toThrow(
      "Failed to read secret from macOS Keychain: security exited with code 1"
    );
  });

  it("rejects secrets with trailing line breaks before writing", async () => {
    const runCommand = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const store = new KeychainStore({ runCommand, service: "my-app", account: "secret" });

    await expect(store.set("my-secret-value\n")).rejects.toThrow(
      "Keychain secrets cannot contain line breaks"
    );
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("returns null when keychain entry is not found", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n",
      exitCode: 44
    }));
    const store = new KeychainStore({ runCommand, service: "my-app", account: "secret" });

    await expect(store.get()).resolves.toBeNull();
  });

  it("deletes secret with security delete-generic-password", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const store = new KeychainStore({ runCommand, service: "my-app", account: "secret" });

    await store.delete();

    expect(runCommand).toHaveBeenCalledWith("security", [
      "delete-generic-password",
      "-s",
      "my-app",
      "-a",
      "secret"
    ]);
  });

  it("does not throw when deleting a missing keychain entry", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: "item not found",
      exitCode: 44
    }));
    const store = new KeychainStore({ runCommand, service: "my-app", account: "secret" });

    await expect(store.delete()).resolves.toBeUndefined();
  });

  it("does not suppress unrelated delete failures mentioning missing items", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: "authorization denied while resolving item not found in audit context",
      exitCode: 1
    }));
    const store = new KeychainStore({ runCommand, service: "my-app", account: "secret" });

    await expect(store.delete()).rejects.toThrow("Failed to delete secret from macOS Keychain");
  });

  it("throws helpful error for security CLI failures", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: "operation failed",
      exitCode: 1
    }));
    const store = new KeychainStore({ runCommand, service: "my-app", account: "secret" });

    await expect(store.set("value")).rejects.toThrow(
      "Failed to store secret in macOS Keychain"
    );
  });
});
