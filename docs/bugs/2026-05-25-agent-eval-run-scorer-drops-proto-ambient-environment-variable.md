---
name: "Agent Eval `runScorer()` Drops a `__proto__` Ambient Environment Variable for Custom Scorers"
---

# Agent Eval `runScorer()` Drops a `__proto__` Ambient Environment Variable for Custom Scorers

## Summary

The exported `@poe-code/agent-eval` `runScorer()` API silently drops an enumerable `process.env.__proto__` variable when it launches a custom scorer command. The scorer receives the injected clone and oracle directories but not all ambient environment input available to the calling process.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/run/__probe__.test.ts`:

```ts
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  readFile: vi.fn(async () => JSON.stringify({ passed: 1, total: 1 }))
}));

vi.mock("@poe-code/process-runner", () => ({
  createHostRunner: () => ({ exec: mocks.exec })
}));

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile
}));

vi.mock("./vitest-runner.js", () => ({
  runVitest: vi.fn()
}));

describe("agent-eval custom scorer ambient environment prototype-key repro", () => {
  beforeEach(() => {
    mocks.exec.mockReset();
    mocks.exec.mockReturnValue({
      result: Promise.resolve({ exitCode: 0 }),
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      kill: vi.fn()
    });
  });

  it("drops process.env.__proto__ before spawning a custom scorer", async () => {
    const { runScorer } = await import("./scorer.js");
    Object.defineProperty(process.env, "__proto__", {
      value: "visible",
      enumerable: true,
      configurable: true,
      writable: true
    });

    try {
      await runScorer({
        evalDef: {
          oracle: { path: "oracle" },
          scorer: {
            command: "true",
            cwd: "",
            resultPath: "score.json",
            timeoutMs: 1000
          }
        } as never,
        evalDir: "/repo/eval",
        cloneDir: "/repo/clone"
      });
    } finally {
      delete process.env.__proto__;
    }

    const env = mocks.exec.mock.calls[0]?.[0].env as Record<string, string>;
    expect(Object.hasOwn(env, "__proto__")).toBe(false);
    expect(env.CLONE_DIR).toBe("/repo/clone");
    expect(env.ORACLE_DIR).toBe("/repo/eval/oracle");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-eval/src/run/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that custom scorer execution starts without the ambient `__proto__` variable. Remove the disposable probe after validation.

## Observed Behavior

After an own enumerable `__proto__ = "visible"` property is added to `process.env`, exported `runScorer()` invokes the custom scorer's mocked runner with `CLONE_DIR` and `ORACLE_DIR` present but no own `__proto__` environment member. In `packages/agent-eval/src/run/scorer.ts`, `createScorerEnv()` builds `env = {}` and assigns every ambient entry through `env[key] = value`; copying `__proto__` does not create an own value on an ordinary object, so the custom scorer command runs without it.

## Expected Behavior

Custom scorer commands should receive every ambient environment value forwarded by `runScorer()`, including `__proto__`, or the API should reject unsupported environment variable names explicitly rather than silently producing a changed execution environment.

## Impact

Custom evaluation scorers can execute with missing configuration compared with the process invoking the evaluation, producing misleading score files, failures, or environment-dependent discrepancies without an explicit startup error.
