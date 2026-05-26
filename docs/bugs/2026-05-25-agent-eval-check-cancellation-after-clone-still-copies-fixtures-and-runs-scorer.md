# Agent eval check cancellation after clone still copies fixtures and runs scorer

## Summary

`@poe-code/agent-eval` exposes an `AbortSignal` on `evalCheck()`, and forwards it into repository cloning and scorer execution, but does not re-check cancellation between those phases. If cancellation occurs while the clone phase completes normally, `evalCheck()` still copies starter/oracle fixture content into the clone and invokes the scorer with an already-aborted operation before returning a successful check result.

## Reproduction

Add the following temporary probe as `packages/agent-eval/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  controller: new AbortController(),
  cp: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
  stat: vi.fn(async () => ({ isDirectory: () => true })),
  cloneTarget: vi.fn(async () => undefined),
  runScorer: vi.fn(async () => ({ passed: 1, total: 1, cases: [] }))
}));

vi.mock("node:fs/promises", () => ({
  cp: mocks.cp,
  mkdir: mocks.mkdir,
  stat: mocks.stat
}));
vi.mock("./source/open.js", () => ({ openSource: vi.fn(async () => ({ rootDir: "/source" })) }));
vi.mock("./source/registry.js", () => ({
  loadEval: vi.fn(async () => ({ target: { repo: "repo", ref: "main" }, oracle: { path: "oracle", solutionDest: "src" } }))
}));
vi.mock("./source/config.js", () => ({ loadSourceConfig: vi.fn(async () => ({ out: "out" })) }));
vi.mock("./run/clone.js", () => ({
  cloneTarget: mocks.cloneTarget.mockImplementation(async () => { mocks.controller.abort(); })
}));
vi.mock("./run/scorer.js", () => ({ runScorer: mocks.runScorer }));

import { evalCheck } from "./check/check.js";

describe("evalCheck cancellation after cloning", () => {
  it("copies fixture material and runs the scorer after the supplied signal aborts", async () => {
    const result = await evalCheck({ sourceDir: "/source", evalId: "task", signal: mocks.controller.signal });

    console.log(JSON.stringify({ aborted: mocks.controller.signal.aborted, cpCalls: mocks.cp.mock.calls.length, scorerCalls: mocks.runScorer.mock.calls.length, result }));
    expect(mocks.controller.signal.aborted).toBe(true);
    expect(mocks.cp).toHaveBeenCalledTimes(2);
    expect(mocks.runScorer).toHaveBeenCalledTimes(1);
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/agent-eval/src/__probe__.test.ts --reporter verbose
rm packages/agent-eval/src/__probe__.test.ts
nl -ba packages/agent-eval/src/check/check.ts | sed -n '10,60p'
nl -ba packages/agent-eval/src/run/clone.ts | sed -n '14,37p;85,91p'
nl -ba packages/agent-eval/src/run/scorer.ts | sed -n '28,54p'
```

The reproduction passes and records work continuing after cancellation:

```text
{"aborted":true,"cpCalls":2,"scorerCalls":1,"result":{"evalId":"task","cloneDir":"/source/out/.check/task/.../clone","tests":{"passed":1,"total":1,"cases":[]},"durationMs":0}}
✓ packages/agent-eval/src/__probe__.test.ts > evalCheck cancellation after cloning > copies fixture material and runs the scorer after the supplied signal aborts
```

## Observed Behavior

`evalCheck()` accepts `signal?: AbortSignal` and passes it into `cloneTarget()` at `packages/agent-eval/src/check/check.ts:23` through `packages/agent-eval/src/check/check.ts:37`. `cloneTarget()` explicitly checks and supports aborting work at `packages/agent-eval/src/run/clone.ts:14` through `packages/agent-eval/src/run/clone.ts:37` and `packages/agent-eval/src/run/clone.ts:85` through `packages/agent-eval/src/run/clone.ts:91`. Once `cloneTarget()` resolves, however, `evalCheck()` does not check `opts.signal.aborted`: it copies starter fixtures, copies the oracle solution, then invokes `runScorer()` at `packages/agent-eval/src/check/check.ts:39` through `packages/agent-eval/src/check/check.ts:52`. In the reproduction the clone adapter aborts the controlling signal while resolving, and both copy operations plus scorer invocation still occur.

## Expected Behavior

After any abortable phase resolves, `evalCheck()` should stop before performing subsequent fixture writes or launching scorer execution when its supplied signal has become aborted. Cancellation during the clone boundary should be surfaced as cancellation rather than a successful evaluation result produced after additional work.

## Impact

Users cancelling an evaluation check can still incur workspace mutations and scorer command execution after cancellation has already been requested. This defeats cancellation as a control for potentially expensive or side-effecting evaluation work, and can misleadingly report a completed passing check for a run that the caller cancelled in flight.
