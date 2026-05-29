import { describe, expect, it, vi } from "vitest";
import { createE2bJobHandle, createE2bLogStreamFs } from "./job-handle.js";
import type { E2bSandbox } from "./sdk.js";

function createSandbox(): E2bSandbox {
  return {
    sandboxId: "sb",
    commands: {
      list: vi.fn().mockResolvedValue([]),
      run: vi.fn().mockResolvedValue({ exitCode: 0 }),
      connect: vi.fn(),
      sendStdin: vi.fn(),
      closeStdin: vi.fn(),
      kill: vi.fn().mockResolvedValue(true)
    },
    files: {
      read: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })),
      write: vi.fn(),
      watchDir: vi.fn().mockResolvedValue({ stop: vi.fn().mockResolvedValue(undefined) })
    },
    pty: {
      create: vi.fn(),
      sendInput: vi.fn(),
      kill: vi.fn().mockResolvedValue(true)
    },
    setTimeout: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined)
  };
}

function createJob(sandbox: E2bSandbox) {
  return createE2bJobHandle({
    sandbox,
    envId: "sb",
    jobId: "job-1",
    tool: "node",
    argv: ["node"],
    preserveAfterExitHours: 24
  });
}

describe("createE2bJobHandle", () => {
  it("rejects an empty exit marker instead of reporting completion", async () => {
    const sandbox = createSandbox();
    vi.mocked(sandbox.files.read).mockResolvedValueOnce("");

    await expect(createJob(sandbox).status()).rejects.toThrow(
      "Invalid exit code in /tmp/poe-jobs/job-1.exit"
    );
  });

  it("surfaces exit-marker read failures other than missing files", async () => {
    const sandbox = createSandbox();
    vi.mocked(sandbox.files.read).mockRejectedValueOnce(new Error("temporary file API outage"));

    await expect(createJob(sandbox).status()).rejects.toThrow("temporary file API outage");
  });
});

describe("createE2bLogStreamFs", () => {
  it("contains rejected watch subscription setup", async () => {
    const sandbox = createSandbox();
    vi.mocked(sandbox.files.watchDir).mockRejectedValueOnce(new Error("watch API offline"));

    createE2bLogStreamFs(sandbox).watch?.("/tmp/poe-jobs/job-1.log", vi.fn());
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it("contains rejected watch subscription cleanup", async () => {
    const sandbox = createSandbox();
    vi.mocked(sandbox.files.watchDir).mockResolvedValueOnce({
      stop: vi.fn().mockRejectedValue(new Error("stop API offline"))
    });
    const watcher = createE2bLogStreamFs(sandbox).watch?.("/tmp/poe-jobs/job-1.log", vi.fn());
    await new Promise<void>((resolve) => setImmediate(resolve));

    watcher?.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});
