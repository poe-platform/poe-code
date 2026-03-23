import { describe, expect, it, vi } from "vitest";
import { KeychainStore } from "./keychain-store.js";

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
      "-w",
      "my-secret-value",
      "-U"
    ]);
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
