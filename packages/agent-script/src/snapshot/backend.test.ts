import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { FileSnapshotBackend } = await import("./backend.js");

describe("FileSnapshotBackend", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves a snapshot value through a write/read round-trip", async () => {
    const backend = new FileSnapshotBackend("/snapshots/run.json");
    const snapshot = {
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

  it("removes snapshots idempotently", async () => {
    const backend = new FileSnapshotBackend("/snapshots/run.json");

    await backend.remove();
    await backend.write({
      sourceHash: "abc123"
    });
    await backend.remove();
    await backend.remove();

    await expect(backend.read()).resolves.toBeUndefined();
  });
});
