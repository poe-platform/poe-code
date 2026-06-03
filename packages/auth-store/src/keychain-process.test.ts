import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

describe("KeychainStore process termination", () => {
  it("rejects writes when the security helper terminates by signal", async () => {
    const spawn = vi.fn();
    vi.doMock("node:child_process", () => ({ spawn }));
    vi.resetModules();
    const { KeychainStore } = await import("./keychain-store.js");
    const child = new EventEmitter() as EventEmitter & {
      stdin: { end: ReturnType<typeof vi.fn> };
      stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
      stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
    };
    child.stdin = { end: vi.fn() };
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    spawn.mockReturnValue(child);
    const store = new KeychainStore({ service: "poe-code", account: "provider:poe" });

    const result = store.set("secret-value");
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    child.emit("close", null, "SIGTERM");

    await expect(result).rejects.toThrow("Failed to store secret in macOS Keychain");
    vi.doUnmock("node:child_process");
  });
});
