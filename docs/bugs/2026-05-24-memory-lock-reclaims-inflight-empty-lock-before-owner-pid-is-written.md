# Memory lock reclaims inflight empty lock before owner PID is written

## Summary

`@poe-code/memory` acquires its lock by creating and writing the `.lock` file with a single asynchronous `writeFile(..., { flag: "wx" })` call. During the interval after exclusive file creation but before the PID contents are written, a competing caller can read an empty file, classify it as invalid, delete it as reclaimable, and enter its protected callback before the original acquisition completes.

## Reproduction

From the repository root, run a disposable Vitest probe that pauses the first `wx` writer after it creates the lock file but before it writes its PID:

```sh
cat > /tmp/memory-lock-inflight-publication-probe.test.ts <<'EOF'
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { withLock, type LockOptions } from "./lock.js";
function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>((res) => { resolve = res; }); return { promise, resolve }; }
describe("memory lock publication race", () => {
  it("reclaims an empty lock while its wx writer is still publishing ownership", async () => {
    const root = "/repo/.poe-code/memory";
    const rawFs = createFsFromVolume(Volume.fromJSON({ [`${root}/INDEX.md`]: "# Index\n" }, "/")).promises as any;
    const lockCreated = deferred();
    const letWriterFinish = deferred();
    const firstEntered = deferred();
    const finishFirst = deferred();
    const secondEntered = deferred();
    const finishSecond = deferred();
    let firstPublish = true;
    const publishingFs: NonNullable<LockOptions["fs"]> = {
      ...rawFs,
      writeFile: async (filePath, data, options) => {
        if (firstPublish && filePath.endsWith('/.lock')) {
          firstPublish = false;
          const handle = await rawFs.open(filePath, 'wx');
          lockCreated.resolve();
          await letWriterFinish.promise;
          await handle.writeFile(data, { encoding: 'utf8' });
          await handle.close();
          return;
        }
        await rawFs.writeFile(filePath, data, options);
      },
    };
    const first = withLock(root, async () => { firstEntered.resolve(); await finishFirst.promise; return 'first'; }, { fs: publishingFs, pid: 111 });
    await lockCreated.promise;
    const emptyWhilePublishing = await rawFs.readFile(`${root}/.lock`, 'utf8');
    const second = withLock(root, async () => { secondEntered.resolve(); await finishSecond.promise; return 'second'; }, { fs: rawFs, pid: 222 });
    await secondEntered.promise;
    letWriterFinish.resolve();
    await firstEntered.promise;
    console.log(JSON.stringify({ emptyWhilePublishing, firstEntered: true, secondEntered: true }));
    expect(emptyWhilePublishing).toBe('');
    finishFirst.resolve();
    finishSecond.resolve();
    await Promise.all([first, second]);
  });
});
EOF
cp /tmp/memory-lock-inflight-publication-probe.test.ts packages/memory/src/__probe__.test.ts
trap 'rm -f packages/memory/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-memory-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/memory/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-memory-probe.config.mjs --reporter verbose
nl -ba packages/memory/src/lock.ts | sed -n '53,147p'
```

## Observed Behavior

While the first acquisition has already exclusively created `.lock` but has not yet written its PID, the second operation reclaims that empty lock and enters its protected callback. Once publication resumes, both callbacks have entered:

```text
{"emptyWhilePublishing":"","firstEntered":true,"secondEntered":true}
✓ packages/memory/src/__probe__.test.ts > memory lock publication race > reclaims an empty lock while its wx writer is still publishing ownership
```

`parsePid()` treats empty content as invalid in `packages/memory/src/lock.ts:53` through `packages/memory/src/lock.ts:67`. `withLock()` publishes ownership through asynchronous `fs.writeFile(..., { flag: "wx" })` in `packages/memory/src/lock.ts:100` through `packages/memory/src/lock.ts:121`, while a contender deletes any invalid lock immediately in `packages/memory/src/lock.ts:128` through `packages/memory/src/lock.ts:135` without allowing in-progress publication to finish.

## Expected Behavior

A lock file already created exclusively by an in-progress acquisition should not be reclaimed merely because its ownership payload is temporarily incomplete during publication.

## Impact

Normal filesystem scheduling can allow two memory mutations to execute concurrently even without stale locks or crashed processes. Writes, appends, clears, and reconciliation operations may overlap and lose updates during routine lock acquisition contention.
