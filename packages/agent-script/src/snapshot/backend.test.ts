import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

const gates = vi.hoisted(() => ({
  holdFirstRename: false,
  firstRenameStarted: undefined as undefined | (() => void),
  releaseFirstRename: undefined as undefined | (() => void),
  firstRenamePending: undefined as undefined | Promise<void>,
  renameCalls: 0,
  cleanupFails: false,
  lockedRenameFailures: 0,
  randomUUIDs: [] as string[],
  randomUUIDCounter: 0
}));

vi.mock("node:crypto", () => ({
  randomUUID: () => gates.randomUUIDs.shift() ?? `fallback-uuid-${gates.randomUUIDCounter += 1}`
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    rename: async (fromPath: string, toPath: string) => {
      gates.renameCalls += 1;
      if (gates.lockedRenameFailures > 0) {
        gates.lockedRenameFailures -= 1;
        throw Object.assign(new Error("locked"), { code: "EBUSY" });
      }
      if (gates.holdFirstRename && gates.renameCalls === 1) {
        gates.firstRenameStarted?.();
        await gates.firstRenamePending;
      }
      await fs.promises.rename(fromPath, toPath);
    },
    unlink: async (filePath: string) => {
      if (gates.cleanupFails && filePath.includes(".tmp")) {
        throw new Error("temp cleanup denied");
      }
      await fs.promises.unlink(filePath);
    }
  };
});

const { FileSnapshotBackend } = await import("./backend.js");

describe("FileSnapshotBackend", () => {
  beforeEach(() => {
    vol.reset();
    gates.holdFirstRename = false;
    gates.renameCalls = 0;
    gates.cleanupFails = false;
    gates.lockedRenameFailures = 0;
    gates.randomUUIDs = [];
    gates.randomUUIDCounter = 0;
    gates.firstRenamePending = undefined;
    gates.firstRenameStarted = undefined;
    gates.releaseFirstRename = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves a snapshot value through a write/read round-trip", async () => {
    vol.mkdirSync("/snapshots");
    const backend = new FileSnapshotBackend("/snapshots/run.json");
    const snapshot = {
      version: 1,
      sourceHash: "abc123",
      clock: {
        next: 42
      },
      bindings: {
        value: "saved"
      }
    };

    await backend.write(snapshot);

    await expect(backend.read()).resolves.toEqual(snapshot);
  });

  it("returns undefined when the snapshot path does not exist", async () => {
    const backend = new FileSnapshotBackend("/snapshots/missing.json");

    await expect(backend.read()).resolves.toBeUndefined();
  });

  it("throws a clear parse error when the snapshot file is truncated", async () => {
    vol.fromJSON({
      "/snapshots/run.json": '{"sourceHash":'
    });

    const backend = new FileSnapshotBackend("/snapshots/run.json");

    await expect(backend.read()).rejects.toThrow(
      "Failed to parse snapshot at /snapshots/run.json:"
    );
  });

  it("removes snapshots idempotently", async () => {
    vol.mkdirSync("/snapshots");
    const backend = new FileSnapshotBackend("/snapshots/run.json");

    await backend.remove();
    await backend.write({
      sourceHash: "abc123"
    });
    await backend.remove();
    await backend.remove();

    await expect(backend.read()).resolves.toBeUndefined();
  });

  it("serializes writes across backend instances targeting the same path", async () => {
    vol.mkdirSync("/snapshots");
    gates.holdFirstRename = true;
    const started = deferred();
    const released = deferred();
    gates.firstRenameStarted = started.resolve;
    gates.firstRenamePending = released.promise;
    const first = new FileSnapshotBackend("/snapshots/run.json", { writeMaxAttempts: 1 });
    const second = new FileSnapshotBackend("/snapshots/run.json", { writeMaxAttempts: 1 });

    const firstWrite = first.write({ sourceHash: "first" });
    await started.promise;
    const secondWrite = second.write({ sourceHash: "second" });
    released.resolve();

    await expect(Promise.all([firstWrite, secondWrite])).resolves.toBeDefined();
    await expect(second.read()).resolves.toMatchObject({ sourceHash: "second" });
  });

  it("waits for another backend write before removing the snapshot", async () => {
    vol.mkdirSync("/snapshots");
    gates.holdFirstRename = true;
    const started = deferred();
    const released = deferred();
    gates.firstRenameStarted = started.resolve;
    gates.firstRenamePending = released.promise;
    const writer = new FileSnapshotBackend("/snapshots/run.json");
    const remover = new FileSnapshotBackend("/snapshots/run.json");

    const writing = writer.write({ sourceHash: "future" });
    await started.promise;
    const removing = remover.remove();
    released.resolve();

    await Promise.all([writing, removing]);
    await expect(remover.read()).resolves.toBeUndefined();
  });

  it("retries a locked commit even when temporary cleanup fails", async () => {
    vol.mkdirSync("/snapshots");
    gates.cleanupFails = true;
    gates.lockedRenameFailures = 1;
    const backend = new FileSnapshotBackend("/snapshots/run.json", {
      writeMaxAttempts: 2,
      writeRetryDelayMs: 0
    });

    await expect(backend.write({ sourceHash: "saved" })).resolves.toBeUndefined();
    await expect(backend.read()).resolves.toMatchObject({ sourceHash: "saved" });
  });

  it("does not follow or remove a colliding temporary snapshot symlink", async () => {
    vol.mkdirSync("/snapshots");
    vol.mkdirSync("/outside");
    const snapshotPath = "/snapshots/run.json";
    const collisionPath = `${snapshotPath}.collision.tmp`;
    vol.writeFileSync("/outside/secret.json", "outside-state\n");
    vol.symlinkSync("/outside/secret.json", collisionPath);
    gates.randomUUIDs = ["collision", "safe"];
    const backend = new FileSnapshotBackend(snapshotPath, {
      writeMaxAttempts: 2,
      writeRetryDelayMs: 0
    });

    await backend.write({ sourceHash: "saved" });

    expect(vol.readFileSync("/outside/secret.json", "utf8")).toBe("outside-state\n");
    expect(vol.lstatSync(collisionPath).isSymbolicLink()).toBe(true);
    await expect(backend.read()).resolves.toMatchObject({ sourceHash: "saved" });
  });
});

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = () => undefined;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
