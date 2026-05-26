# File lock metadata write failure reports acquisition and permits second owner

## Summary

`acquireFileLock()` suppresses failures while writing ownership metadata into a newly created lock file and still returns a successful release callback. A lock whose metadata write failed is therefore indistinguishable from an abandoned or foreign stale lock; once its timestamp reaches `staleMs`, another caller can reclaim it while the first caller still believes it exclusively owns the resource.

## Reproduction

From the repository root, run a disposable Vitest probe whose first lockfile metadata write fails, then ages the resulting empty lock and performs a second acquisition:

```sh
cat > /tmp/file-lock-metadata-write-failure-probe.test.ts <<'EOF'
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { acquireFileLock, type FileLockFs } from "./lock.js";

describe("metadata write failure", () => {
  it("allows another owner to reclaim a held lock whose metadata write failed", async () => {
    vi.setSystemTime(new Date("2026-05-24T18:30:00.000Z"));
    const volume = Volume.fromJSON({ "/repo/workflow.md": "# workflow\n" }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    let failMetadata = true;
    const fs: FileLockFs = {
      ...(rawFs as any),
      open: async (filePath, flags) => {
        const handle = await rawFs.open(filePath, flags as any);
        return {
          close: () => handle.close(),
          writeFile: async (data, options) => {
            if (failMetadata) {
              failMetadata = false;
              throw new Error("disk write failed");
            }
            await handle.writeFile(data, options as any);
          },
        };
      },
    };

    const releaseFirst = await acquireFileLock("/repo/workflow.md", { fs, staleMs: 1000 });
    const emptyLock = await rawFs.readFile("/repo/workflow.md.lock", "utf8");
    volume.utimesSync(
      "/repo/workflow.md.lock",
      new Date("2026-05-24T18:29:00.000Z"),
      new Date("2026-05-24T18:29:00.000Z"),
    );
    const releaseSecond = await acquireFileLock("/repo/workflow.md", { fs, staleMs: 1000 });
    const replacedLock = await rawFs.readFile("/repo/workflow.md.lock", "utf8");

    console.log(JSON.stringify({ emptyLock, secondAcquired: replacedLock.includes("pid") }));
    expect(emptyLock).toBe("");
    expect(replacedLock).toContain("pid");

    await releaseSecond();
    await releaseFirst();
  });
});
EOF
cp /tmp/file-lock-metadata-write-failure-probe.test.ts packages/file-lock/src/__probe__.test.ts
trap 'rm -f packages/file-lock/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-file-lock-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/file-lock/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-file-lock-probe.config.mjs --reporter verbose
nl -ba packages/file-lock/src/lock.ts | sed -n '136,279p'
```

## Observed Behavior

The first acquisition succeeds even though the resulting lock file is empty, and a second acquisition subsequently succeeds for the same protected file:

```text
{"emptyLock":"","secondAcquired":true}
✓ packages/file-lock/src/__probe__.test.ts > metadata write failure > allows another owner to reclaim a held lock whose metadata write failed
```

`writeLockMetadata()` catches and ignores any `handle.writeFile(...)` error in `packages/file-lock/src/lock.ts:200` through `packages/file-lock/src/lock.ts:214`. `acquireFileLock()` nevertheless returns a successful ownership release callback immediately afterward in `packages/file-lock/src/lock.ts:230` through `packages/file-lock/src/lock.ts:245`. Later acquisition treats missing/invalid metadata according to lockfile age and removes it as stale in `packages/file-lock/src/lock.ts:162` through `packages/file-lock/src/lock.ts:197` and `packages/file-lock/src/lock.ts:252` through `packages/file-lock/src/lock.ts:276`.

## Expected Behavior

Acquisition must not report successful exclusive ownership unless lock ownership metadata has been persisted successfully, or it must retain another reliable owner token that prevents a live holder from being reclaimed as stale.

## Impact

A transient filesystem write failure can turn an exclusive workflow lock into simultaneous ownership. Two pipelines, experiment loops, superintendent sessions, or maestro runs may concurrently mutate the same workflow document after both are told they own its lock.
