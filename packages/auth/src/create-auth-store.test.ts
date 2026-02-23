import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createAuthStore } from "./index.js";
import type { EncryptedFileAuthStoreFileSystem } from "./encrypted-file-auth-store.js";

function createMemFs(): EncryptedFileAuthStoreFileSystem {
  const volume = new Volume();
  return createFsFromVolume(volume).promises as unknown as EncryptedFileAuthStoreFileSystem;
}

async function writePlaintextCredentials(
  fs: EncryptedFileAuthStoreFileSystem,
  filePath: string,
  document: Record<string, unknown>
): Promise<void> {
  const credentialsDirectory = filePath.slice(0, filePath.lastIndexOf("/"));
  await fs.mkdir(credentialsDirectory, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: "utf8"
  });
}

function createKeychainCommandRunner() {
  return vi.fn(async (_command: string, args: string[]) => {
    if (args[0] === "find-generic-password") {
      return {
        stdout: "keychain-key\n",
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

describe("createAuthStore", () => {
  it("creates file backend store by default", async () => {
    const filePath = "/home/test/.poe-code/credentials.enc";
    const fs = createMemFs();
    const result = createAuthStore({
      fileStore: {
        fs,
        filePath,
        getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
      }
    });

    expect(result.backend).toBe("file");
    expect(await result.store.getApiKey()).toBeNull();

    await result.store.setApiKey("poe-test-key");
    expect(await result.store.getApiKey()).toBe("poe-test-key");
    expect(await fs.readFile(filePath, "utf8")).not.toContain("poe-test-key");

    await result.store.deleteApiKey();
    expect(await result.store.getApiKey()).toBeNull();
  });

  it("uses file backend when POE_AUTH_BACKEND=file", async () => {
    const filePath = "/home/test/.poe-code/credentials.enc";
    const fs = createMemFs();
    const result = createAuthStore({
      env: {
        POE_AUTH_BACKEND: "file"
      },
      platform: "linux",
      fileStore: {
        fs,
        filePath,
        getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
      }
    });

    expect(result.backend).toBe("file");
    await result.store.setApiKey("poe-test-key");
    expect(await result.store.getApiKey()).toBe("poe-test-key");
  });

  it("uses keychain backend when POE_AUTH_BACKEND=keychain on macOS", async () => {
    const runCommand = createKeychainCommandRunner();

    const result = createAuthStore({
      env: {
        POE_AUTH_BACKEND: "keychain"
      },
      platform: "darwin",
      keychainStore: {
        runCommand
      }
    });

    expect(result.backend).toBe("keychain");
    await result.store.setApiKey("keychain-key");
    expect(await result.store.getApiKey()).toBe("keychain-key");

    expect(runCommand).toHaveBeenCalledWith("security", [
      "add-generic-password",
      "-s",
      "poe-code",
      "-a",
      "api-key",
      "-w",
      "keychain-key",
      "-U"
    ]);
  });

  it("throws when POE_AUTH_BACKEND=keychain on non-macOS", () => {
    expect(() => {
      createAuthStore({
        env: {
          POE_AUTH_BACKEND: "keychain"
        },
        platform: "linux"
      });
    }).toThrowError(
      "POE_AUTH_BACKEND=keychain is only supported on macOS. Current platform: linux"
    );
  });

  it("reads POE_AUTH_BACKEND from process.env", async () => {
    vi.stubEnv("POE_AUTH_BACKEND", "keychain");
    const runCommand = createKeychainCommandRunner();

    const result = createAuthStore({
      platform: "darwin",
      keychainStore: {
        runCommand
      }
    });

    expect(result.backend).toBe("keychain");
    await result.store.setApiKey("keychain-key");
    expect(runCommand).toHaveBeenCalledWith("security", [
      "add-generic-password",
      "-s",
      "poe-code",
      "-a",
      "api-key",
      "-w",
      "keychain-key",
      "-U"
    ]);
  });

  it("migrates plaintext apiKey from credentials.json into auth store", async () => {
    const authPath = "/home/test/.poe-code/credentials.enc";
    const credentialsPath = "/home/test/.poe-code/credentials.json";
    const fileFs = createMemFs();
    const plaintextFs = createMemFs();

    await writePlaintextCredentials(plaintextFs, credentialsPath, {
      apiKey: "plaintext-key",
      configured_services: {
        claude: {
          files: ["/tmp/a.json"]
        }
      }
    });

    const result = createAuthStore({
      fileStore: {
        fs: fileFs,
        filePath: authPath,
        getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
      },
      legacyCredentials: {
        fs: plaintextFs,
        filePath: credentialsPath
      }
    });

    await expect(result.store.getApiKey()).resolves.toBe("plaintext-key");

    const encryptedPayload = await fileFs.readFile(authPath, "utf8");
    expect(encryptedPayload).not.toContain("plaintext-key");

    const migratedPlaintext = JSON.parse(
      await plaintextFs.readFile(credentialsPath, "utf8")
    ) as Record<string, unknown>;

    expect(migratedPlaintext).not.toHaveProperty("apiKey");
    expect(migratedPlaintext.configured_services).toEqual({
      claude: {
        files: ["/tmp/a.json"]
      }
    });
  });

  it("logs warning and returns plaintext key when migration fails", async () => {
    const credentialsPath = "/home/test/.poe-code/credentials.json";
    const plaintextFs = createMemFs();
    const logWarning = vi.fn();

    await writePlaintextCredentials(plaintextFs, credentialsPath, {
      apiKey: "plaintext-key"
    });

    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "find-generic-password") {
        return {
          stdout: "",
          stderr: "item not found",
          exitCode: 44
        };
      }

      return {
        stdout: "",
        stderr: "save failed",
        exitCode: 1
      };
    });

    const result = createAuthStore({
      env: {
        POE_AUTH_BACKEND: "keychain"
      },
      platform: "darwin",
      keychainStore: {
        runCommand
      },
      legacyCredentials: {
        fs: plaintextFs,
        filePath: credentialsPath,
        logWarning
      }
    });

    await expect(result.store.getApiKey()).resolves.toBe("plaintext-key");
    expect(logWarning).toHaveBeenCalledTimes(1);

    const legacyDocument = JSON.parse(
      await plaintextFs.readFile(credentialsPath, "utf8")
    ) as Record<string, unknown>;
    expect(legacyDocument.apiKey).toBe("plaintext-key");
  });

  it("does not retry plaintext migration after a failed migration attempt", async () => {
    const credentialsPath = "/home/test/.poe-code/credentials.json";
    const plaintextFs = createMemFs();
    const plaintextRead = vi.fn(plaintextFs.readFile.bind(plaintextFs));
    const logWarning = vi.fn();

    await writePlaintextCredentials(plaintextFs, credentialsPath, {
      apiKey: "plaintext-key"
    });

    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "find-generic-password") {
        return {
          stdout: "",
          stderr: "item not found",
          exitCode: 44
        };
      }

      return {
        stdout: "",
        stderr: "save failed",
        exitCode: 1
      };
    });

    const result = createAuthStore({
      env: {
        POE_AUTH_BACKEND: "keychain"
      },
      platform: "darwin",
      keychainStore: {
        runCommand
      },
      legacyCredentials: {
        fs: {
          ...plaintextFs,
          readFile: plaintextRead
        },
        filePath: credentialsPath,
        logWarning
      }
    });

    await expect(result.store.getApiKey()).resolves.toBe("plaintext-key");
    await expect(result.store.getApiKey()).resolves.toBeNull();

    expect(plaintextRead).toHaveBeenCalledTimes(1);
    expect(logWarning).toHaveBeenCalledTimes(1);
  });

  it("uses auth store directly on subsequent reads after migration", async () => {
    const authPath = "/home/test/.poe-code/credentials.enc";
    const credentialsPath = "/home/test/.poe-code/credentials.json";
    const fileFs = createMemFs();
    const plaintextFs = createMemFs();
    const plaintextRead = vi.fn(plaintextFs.readFile.bind(plaintextFs));

    await writePlaintextCredentials(plaintextFs, credentialsPath, {
      apiKey: "plaintext-key"
    });

    const result = createAuthStore({
      fileStore: {
        fs: fileFs,
        filePath: authPath,
        getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
      },
      legacyCredentials: {
        fs: {
          ...plaintextFs,
          readFile: plaintextRead
        },
        filePath: credentialsPath
      }
    });

    await expect(result.store.getApiKey()).resolves.toBe("plaintext-key");
    expect(plaintextRead).toHaveBeenCalledTimes(1);

    await expect(result.store.getApiKey()).resolves.toBe("plaintext-key");
    expect(plaintextRead).toHaveBeenCalledTimes(1);
  });

  it("does not check plaintext credentials when auth store already has key", async () => {
    const authPath = "/home/test/.poe-code/credentials.enc";
    const credentialsPath = "/home/test/.poe-code/credentials.json";
    const fileFs = createMemFs();
    const plaintextFs = createMemFs();
    const plaintextRead = vi.fn(plaintextFs.readFile.bind(plaintextFs));

    await writePlaintextCredentials(plaintextFs, credentialsPath, {
      apiKey: "plaintext-key"
    });

    const result = createAuthStore({
      fileStore: {
        fs: fileFs,
        filePath: authPath,
        getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
      },
      legacyCredentials: {
        fs: {
          ...plaintextFs,
          readFile: plaintextRead
        },
        filePath: credentialsPath
      }
    });

    await result.store.setApiKey("stored-key");

    await expect(result.store.getApiKey()).resolves.toBe("stored-key");
    expect(plaintextRead).not.toHaveBeenCalled();
  });

  it("checks plaintext credentials only once when no legacy apiKey exists", async () => {
    const authPath = "/home/test/.poe-code/credentials.enc";
    const credentialsPath = "/home/test/.poe-code/credentials.json";
    const fileFs = createMemFs();
    const plaintextFs = createMemFs();
    const plaintextRead = vi.fn(plaintextFs.readFile.bind(plaintextFs));

    await writePlaintextCredentials(plaintextFs, credentialsPath, {
      configured_services: {
        codex: {
          files: ["/tmp/config.json"]
        }
      }
    });

    const result = createAuthStore({
      fileStore: {
        fs: fileFs,
        filePath: authPath,
        getMachineIdentity: () => ({ hostname: "host-a", username: "user-a" })
      },
      legacyCredentials: {
        fs: {
          ...plaintextFs,
          readFile: plaintextRead
        },
        filePath: credentialsPath
      }
    });

    await expect(result.store.getApiKey()).resolves.toBeNull();
    await expect(result.store.getApiKey()).resolves.toBeNull();

    expect(plaintextRead).toHaveBeenCalledTimes(1);
  });
});
