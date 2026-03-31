import { afterEach, describe, expect, it, vi } from "bun:test";
import { Volume, createFsFromVolume } from "memfs";
import { createSecretStore } from "./index.js";
import type { EncryptedFileStoreFileSystem } from "./encrypted-file-store.js";

function createMemFs(): EncryptedFileStoreFileSystem {
  const volume = new Volume();
  return createFsFromVolume(volume).promises as unknown as EncryptedFileStoreFileSystem;
}

const TEST_SALT = "test-app:store:v1";

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

const envBackup: Record<string, string | undefined> = {};

afterEach(() => {
  for (const key of Object.keys(envBackup)) {
    if (envBackup[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = envBackup[key];
    }
  }
  for (const key of Object.keys(envBackup)) {
    delete envBackup[key];
  }
});

describe("createSecretStore", () => {
  it("creates file backend store by default", async () => {
    const filePath = "/home/test/.app/credentials.enc";
    const fs = createMemFs();
    const result = createSecretStore({
      fileStore: {
        fs,
        filePath,
        salt: TEST_SALT,
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
        salt: TEST_SALT,
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
      "-w",
      "keychain-secret",
      "-U"
    ]);
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
    envBackup["CUSTOM_BACKEND"] = process.env["CUSTOM_BACKEND"];
    process.env["CUSTOM_BACKEND"] = "keychain";
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
});
