# Agent Script Snapshot Remove Does Not Wait For Other Backend Inflight Write

## Summary

The exported `FileSnapshotBackend.remove()` waits only for writes queued on the same backend instance. If another backend instance is currently writing the same snapshot path, `remove()` can resolve with no snapshot visible and the in-flight writer can then publish a new snapshot immediately afterward, undoing the apparent removal.

## Reproduction

Create a disposable Vitest probe at `packages/agent-script/src/snapshot/__probe__.test.ts`:

```ts
import { fs as memfs, vol } from "memfs";
import { expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({
  release: undefined as undefined | (() => void),
  waiting: undefined as undefined | Promise<void>
}));

vi.mock("node:fs/promises", async () => ({
  ...memfs.promises,
  async rename(oldPath: string, newPath: string) {
    await gate.waiting;
    await memfs.promises.rename(oldPath, newPath);
  }
}));

const { FileSnapshotBackend } = await import("./backend.js");

it("lets one backend remove while another write is in flight and then reappear", async () => {
  vol.reset();
  vol.mkdirSync("/snapshots", { recursive: true });
  gate.waiting = new Promise<void>((resolve) => { gate.release = resolve; });
  const writer = new FileSnapshotBackend("/snapshots/run.json");
  const remover = new FileSnapshotBackend("/snapshots/run.json");

  const pendingWrite = writer.write({ sourceHash: "future" });
  await vi.waitFor(() => expect(vol.existsSync("/snapshots/run.json.tmp")).toBe(true));
  await expect(remover.remove()).resolves.toBeUndefined();
  await expect(remover.read()).resolves.toBeUndefined();

  gate.release!();
  await expect(pendingWrite).resolves.toBeUndefined();
  await expect(remover.read()).resolves.toMatchObject({ sourceHash: "future" });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-script/src/snapshot/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-script/src/snapshot/__probe__.test.ts > lets one backend remove while another write is in flight and then reappear
```

Remove the disposable probe after validation.

## Observed Behavior

`FileSnapshotBackend.write()` serializes only writes made through its own private `#pendingWrite` promise, and `remove()` waits only for that same instance's promise before unlinking the snapshot at `packages/agent-script/src/snapshot/backend.ts:24` through `packages/agent-script/src/snapshot/backend.ts:74`. In the probe, a writer backend has already staged a future snapshot but is paused before rename. A separate remover backend resolves `remove()` and immediately observes no snapshot. Once the original writer resumes, it renames its staged file into the deleted path, and the supposedly removed snapshot reappears.

## Expected Behavior

Removing or resetting a snapshot should coordinate with all outstanding writes targeting that path, or guarantee that successful removal prevents any earlier in-flight write from later republishing state. A completed reset operation should not be undone by work that began before it resolved.

## Impact

Concurrent snapshot saving and reset/remove actions can violate user expectations around discarding saved workflow state. A user or automation may successfully reset a run and then unexpectedly resume from a snapshot that reappeared afterward, replaying obsolete state or side effects that the reset was intended to abandon.
