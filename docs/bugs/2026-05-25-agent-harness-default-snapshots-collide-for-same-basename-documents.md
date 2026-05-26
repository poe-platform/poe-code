# Agent harness default snapshots collide for same-basename documents

## Summary

`@poe-code/agent-harness` derives its default persisted snapshot and host-call replay store from only the Markdown document's basename. Two distinct harness documents such as `/repo/a/shared.md` and `/repo/b/shared.md` therefore reuse the same `snapshot.json` state. When their `.ajs` sources are identical, the second document silently resumes host-call data produced while executing the first document instead of starting with its own state.

## Reproduction

Create the disposable probe `packages/agent-harness/src/loader/__probe__.test.ts`:

```ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});

const { runHarnessPair } = await import("./run.js");

beforeEach(() => vol.reset());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("resumes a same-basename document from another document's default snapshot", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-25T00:00:00.000Z"));

  const firstPath = "/repo/a/shared.md";
  const secondPath = "/repo/b/shared.md";
  const source = [
    'import { step } from "host";',
    "export default async () => {",
    "  const first = await step('first');",
    "  const second = await step('second');",
    "  return first.concat('|').concat(second);",
    "};"
  ].join("\n");
  vol.fromJSON({
    [firstPath]: "---\nkind: shared\nversion: 1\n---\n",
    "/repo/a/shared.ajs": source,
    [secondPath]: "---\nkind: shared\nversion: 1\n---\n",
    "/repo/b/shared.ajs": source
  });

  const firstResult = createDeferred<string>();
  const secondResult = createDeferred<string>();
  const controller = new AbortController();
  const firstCalls: string[] = [];
  const firstRun = runHarnessPair(firstPath, {
    modulesFor: () => ({
      host: {
        async step(name: string) {
          firstCalls.push(name);
          return name === "first" ? firstResult.promise : secondResult.promise;
        }
      }
    }),
    signal: controller.signal
  });

  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(30_000);
  firstResult.resolve("first-document-secret");
  await flushMicrotasks();
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  secondResult.reject(new Error("aborted"));
  await expect(firstRun).rejects.toMatchObject({ name: "AbortError" });

  const secondCalls: string[] = [];
  const secondRun = await runHarnessPair(secondPath, {
    modulesFor: () => ({
      host: {
        async step(name: string) {
          secondCalls.push(name);
          return `second-document-${name}`;
        }
      }
    })
  });

  expect(secondCalls).toEqual(["second"]);
  expect(secondRun).toMatchObject({
    ok: true,
    returnValue: "first-document-secret|second-document-second"
  });
});

function createDeferred<TValue>() {
  let resolve!: (value: TValue) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<TValue>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
```

Run:

```sh
npm exec -- vitest run packages/agent-harness/src/loader/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/agent-harness/src/loader/__probe__.test.ts > resumes a same-basename document from another document's default snapshot
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`slugifyPlanPath()` discards every directory component and retains only the filename stem at `packages/agent-harness-tools/src/run-logs.ts:14` through `packages/agent-harness-tools/src/run-logs.ts:18`, and `resolveRunLogDir()` uses that slug as the persisted runner directory at `packages/agent-harness-tools/src/run-logs.ts:9` through `packages/agent-harness-tools/src/run-logs.ts:11`. `runHarnessPair()` selects its default snapshot with that directory at `packages/agent-harness/src/loader/run.ts:102` through `packages/agent-harness/src/loader/run.ts:117` and `packages/agent-harness/src/loader/run.ts:602` through `packages/agent-harness/src/loader/run.ts:613`; the related host-call records are loaded from the same snapshot-derived path at `packages/agent-harness/src/loader/run.ts:421` through `packages/agent-harness/src/loader/run.ts:427` and `packages/agent-harness/src/loader/run.ts:568` through `packages/agent-harness/src/loader/run.ts:569`. In the probe, executing `/repo/a/shared.md` persists `"first-document-secret"`, then `/repo/b/shared.md` invokes only its `second` host call and completes with the first document's saved result.

## Expected Behavior

Default persisted harness state must be scoped to a unique document identity, not only a shared basename. A run of `/repo/b/shared.md` should not see, validate against, replay, remove, or overwrite snapshot and host-call state created by `/repo/a/shared.md` unless the caller explicitly requests that shared snapshot path.

## Impact

Repositories commonly contain repeated document names such as `resume.md`, `run.md`, or `shared.md` in separate suites or examples. An interrupted run in one directory can leak prior host-call values into another same-named workflow, silently producing results from the wrong document context; if source differs, it can instead prevent an unrelated workflow from running by treating another document's snapshot as its own.
