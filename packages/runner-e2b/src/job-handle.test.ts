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
      list: vi.fn(),
      makeDir: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      getInfo: vi.fn(),
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

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

describe("createE2bJobHandle", () => {
  it("rejects an empty exit marker instead of reporting completion", async () => {
    const sandbox = createSandbox();
    vi.mocked(sandbox.files.read).mockResolvedValueOnce("");

    await expect(createJob(sandbox).status()).rejects.toThrow(
      "Invalid exit code in /tmp/poe-jobs/job-1.exit"
    );
  });

  it.each(["0x10\n", "1e2\n"])(
    "rejects non-decimal exit-marker syntax %j",
    async (contents) => {
      const sandbox = createSandbox();
      vi.mocked(sandbox.files.read).mockResolvedValueOnce(contents);

      await expect(createJob(sandbox).status()).rejects.toThrow(
        "Invalid exit code in /tmp/poe-jobs/job-1.exit"
      );
    }
  );

  it("surfaces exit-marker read failures other than missing files", async () => {
    const sandbox = createSandbox();
    vi.mocked(sandbox.files.read).mockRejectedValueOnce(new Error("temporary file API outage"));

    await expect(createJob(sandbox).status()).rejects.toThrow("temporary file API outage");
  });

  it("surfaces exit-marker read failures with inherited missing-file codes", async () => {
    const sandbox = createSandbox();
    const readError = new Error("temporary file API outage");
    vi.mocked(sandbox.files.read).mockRejectedValueOnce(readError);

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(createJob(sandbox).status()).rejects.toBe(readError);
    });
    expect(sandbox.commands.list).not.toHaveBeenCalled();
  });

  it("sends the requested stop signal to detached processes", async () => {
    const sandbox = createSandbox();
    const job = createE2bJobHandle({
      sandbox,
      envId: "sb",
      jobId: "job-1",
      tool: "node",
      argv: ["node"],
      pid: 42,
      preserveAfterExitHours: 24
    });

    await job.kill("SIGTERM");
    await job.kill("SIGKILL");

    expect(sandbox.commands.run).toHaveBeenNthCalledWith(1, "kill -s 'TERM' -- '42'");
    expect(sandbox.commands.run).toHaveBeenNthCalledWith(2, "kill -s 'KILL' -- '42'");
    expect(sandbox.commands.kill).not.toHaveBeenCalled();
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
