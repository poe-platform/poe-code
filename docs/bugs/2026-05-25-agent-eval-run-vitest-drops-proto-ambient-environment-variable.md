# Agent Eval `runVitest()` Drops a `__proto__` Ambient Environment Variable

## Summary

The public `@poe-code/agent-eval` `runVitest()` API copies ambient environment variables into the process used for its default Vitest scorer, but silently drops an ambient variable named `__proto__`. Its scorer-run environment builder uses an ordinary object with dynamic bracket assignment.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/run/__probe__.test.ts`:

```ts
import { tmpdir } from "node:os";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRunner } from "@poe-code/process-runner/testing";
import type { Runner, RunSpec } from "@poe-code/process-runner";

const mocks = vi.hoisted(() => ({ createHostRunner: vi.fn() }));
vi.mock("@poe-code/process-runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/process-runner")>()),
  createHostRunner: mocks.createHostRunner
}));
vi.mock("node:fs/promises", async () => ({ ...(await import("memfs")).fs.promises }));
const { runVitest } = await import("./vitest-runner.js");

describe("eval vitest ambient env prototype-key repro", () => {
  const previous = process.env.__proto__;
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(tmpdir(), { recursive: true });
    process.env.__proto__ = "visible";
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.__proto__;
    else process.env.__proto__ = previous;
  });

  it("drops ambient __proto__ before spawning the default scorer", async () => {
    const base = createMockRunner([{ exitCode: 0 }]);
    let received: RunSpec | undefined;
    const runner: Runner = {
      name: base.name,
      exec(spec) {
        received = spec;
        const index = spec.args?.indexOf("--outputFile") ?? -1;
        vol.writeFileSync(spec.args![index + 1]!, JSON.stringify({ testResults: [] }));
        return base.exec(spec);
      }
    };
    mocks.createHostRunner.mockReturnValue(runner);

    await runVitest({ testsDir: "/tests", cloneDir: "/clone", oracleDir: "/oracle", timeoutMs: 1000 });

    expect(Object.hasOwn(received!.env!, "__proto__")).toBe(false);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-eval/src/run/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that `runVitest()` successfully creates a scorer run specification that lacks the ambient environment entry. Remove the disposable probe after validation.

## Observed Behavior

After setting `process.env.__proto__ = "visible"`, calling exported `runVitest()` causes its mocked host runner to receive an `env` object without an own `__proto__` property. `packages/agent-eval/src/run/vitest-runner.ts` creates the public API's run specification through `createVitestRunSpec()`, whose `createVitestEnv()` loops over `Object.entries(process.env)` and assigns every ambient key into `env = {}` using `env[key] = value` before spawning Vitest.

## Expected Behavior

The default evaluation scorer should preserve each ambient environment value forwarded to the spawned Vitest process, including `__proto__`, or explicitly reject environment names it cannot safely pass through.

## Impact

Evaluation tests can run under an environment different from the invoking process without warning. Oracles or test harnesses that depend on an ambient value can produce misleading scores, failures, or non-reproducible evaluation outcomes because the scorer silently starts with incomplete configuration.
