import { describe, expect, it, vi } from "vitest";
import { KeychainAuthStore } from "./keychain-auth-store.js";

describe("KeychainAuthStore", () => {
  it("stores API key with security add-generic-password", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const store = new KeychainAuthStore({ runCommand });

    await store.setApiKey("poe-secret-key");

    expect(runCommand).toHaveBeenCalledWith("security", [
      "add-generic-password",
      "-s",
      "poe-code",
      "-a",
      "api-key",
      "-w",
      "poe-secret-key",
      "-U"
    ]);
  });

  it("reads API key with security find-generic-password", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "poe-secret-key\n",
      stderr: "",
      exitCode: 0
    }));
    const store = new KeychainAuthStore({ runCommand });

    await expect(store.getApiKey()).resolves.toBe("poe-secret-key");
    expect(runCommand).toHaveBeenCalledWith("security", [
      "find-generic-password",
      "-s",
      "poe-code",
      "-a",
      "api-key",
      "-w"
    ]);
  });

  it("returns null when keychain entry is not found", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n",
      exitCode: 44
    }));
    const store = new KeychainAuthStore({ runCommand });

    await expect(store.getApiKey()).resolves.toBeNull();
  });

  it("deletes API key with security delete-generic-password", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const store = new KeychainAuthStore({ runCommand });

    await store.deleteApiKey();

    expect(runCommand).toHaveBeenCalledWith("security", [
      "delete-generic-password",
      "-s",
      "poe-code",
      "-a",
      "api-key"
    ]);
  });

  it("does not throw when deleting a missing keychain entry", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: "item not found",
      exitCode: 44
    }));
    const store = new KeychainAuthStore({ runCommand });

    await expect(store.deleteApiKey()).resolves.toBeUndefined();
  });

  it("throws helpful error for security CLI failures", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: "operation failed",
      exitCode: 1
    }));
    const store = new KeychainAuthStore({ runCommand });

    await expect(store.setApiKey("poe-secret-key")).rejects.toThrow(
      "Failed to store API key in macOS Keychain"
    );
  });
});
