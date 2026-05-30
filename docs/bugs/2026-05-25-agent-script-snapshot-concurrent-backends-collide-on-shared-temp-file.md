---
name: "Agent Script Snapshot Concurrent Backends Collide On Shared Temp File"
---

# Agent Script Snapshot Concurrent Backends Collide On Shared Temp File

## Summary

The exported `FileSnapshotBackend` serializes writes only within each instance, while every instance targeting a path stages data through the same fixed `<snapshot>.tmp` filename. Concurrent backends for the same snapshot can overwrite or rename one another's staging file, causing one valid write to reject even though it did not encounter a real filesystem failure.

## Reproduction

Create a disposable Vitest probe at `packages/agent-script/src/snapshot/__probe__.test.ts`:

```ts
import { fs as memfs, vol } from "memfs";
import { beforeEach, expect, it, vi } from "vitest";

const renameGate = vi.hoisted(() => ({
  calls: 0,
  releaseFirst: undefined as undefined | (() => void),
  firstWaiting: undefined as undefined | Promise<void>
}));

vi.mock("node:fs/promises", async () => ({
  ...memfs.promises,
  async rename(oldPath: string, newPath: string) {
    renameGate.calls += 1;
    if (renameGate.calls === 1) {
      await renameGate.firstWaiting;
    } else if (renameGate.releaseFirst) {
      renameGate.releaseFirst();
    }
    await memfs.promises.rename(oldPath, newPath);
  }
}));

const { FileSnapshotBackend } = await import("./backend.js");

beforeEach(() => {
  vol.reset();
  vol.mkdirSync("/snapshots", { recursive: true });
  renameGate.calls = 0;
  renameGate.firstWaiting = new Promise<void>((resolve) => { renameGate.releaseFirst = resolve; });
});

it("lets concurrent backends collide on the shared temporary snapshot path", async () => {
  const first = new FileSnapshotBackend("/snapshots/run.json", { writeMaxAttempts: 1 });
  const second = new FileSnapshotBackend("/snapshots/run.json", { writeMaxAttempts: 1 });
  const firstWrite = first.write(snapshot("first"));
  await vi.waitFor(() => expect(renameGate.calls).toBe(1));
  await expect(second.write(snapshot("second"))).resolves.toBeUndefined();
  await expect(firstWrite).rejects.toThrow();

  const saved = await second.read();
  expect(saved?.sourceHash).toBe("second");
});

function snapshot(sourceHash: string) {
  return { version: 1, sourceHash, vars: {}, heap: [] };
}
```

Run:

```sh
npm exec -- vitest run packages/agent-script/src/snapshot/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-script/src/snapshot/__probe__.test.ts > lets concurrent backends collide on the shared temporary snapshot path
```

Remove the disposable probe after validation.

## Observed Behavior

Each `FileSnapshotBackend` chains only its own writes through private `#pendingWrite` state at `packages/agent-script/src/snapshot/backend.ts:24` through `packages/agent-script/src/snapshot/backend.ts:72`. The atomic writer always uses `${snapshotPath}.tmp` as its staging file at `packages/agent-script/src/snapshot/backend.ts:78` through `packages/agent-script/src/snapshot/backend.ts:107` and `packages/agent-script/src/snapshot/backend.ts:140` through `packages/agent-script/src/snapshot/backend.ts:159`. In the probe, backend one writes the shared temp file and pauses before rename; backend two overwrites and renames that same temp file successfully; when backend one resumes, its rename rejects because its staged path has already been consumed.

## Expected Behavior

Independent backend instances writing the same snapshot path should either coordinate deterministically or use unique staging filenames so their intermediate writes cannot collide. One writer may supersede another by a defined last-write policy, but a valid write should not fail merely because another backend used its private temp file.

## Impact

Parallel agent-script runs, resume/snapshot controls, or separate callers targeting the same snapshot file can experience spurious persistence failures and timing-dependent retained state. A run can report that snapshot saving failed even while another concurrent run published its data, making recovery and replay behavior unreliable under concurrent automation.
