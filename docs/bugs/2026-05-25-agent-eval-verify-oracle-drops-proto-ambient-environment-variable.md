---
name: "Agent Eval `verifyOracle()` Drops a `__proto__` Ambient Environment Variable"
---

# Agent Eval `verifyOracle()` Drops a `__proto__` Ambient Environment Variable

## Summary

The exported `@poe-code/agent-eval` `verifyOracle()` API silently drops an enumerable `process.env.__proto__` variable while constructing the environment for an oracle verification command. The verification command still starts with `ORACLE_DIR`, but it does not receive all ambient environment values available to the caller.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/run/__probe__.test.ts`:

```ts
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  loadEval: vi.fn(async () => ({
    verify: { command: "true", timeoutMs: 1000 }
  }))
}));

vi.mock("@poe-code/process-runner", () => ({
  createHostRunner: () => ({ exec: mocks.exec })
}));

vi.mock("../source/registry.js", () => ({
  loadEval: mocks.loadEval
}));

describe("agent-eval oracle ambient environment prototype-key repro", () => {
  beforeEach(() => {
    mocks.exec.mockReset();
    mocks.exec.mockReturnValue({
      result: Promise.resolve({ exitCode: 0 }),
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      kill: vi.fn()
    });
  });

  it("drops process.env.__proto__ before spawning the verify command", async () => {
    const { verifyOracle } = await import("./oracle.js");
    Object.defineProperty(process.env, "__proto__", {
      value: "visible",
      enumerable: true,
      configurable: true,
      writable: true
    });

    try {
      await verifyOracle({ rootDir: "/repo/evals" } as never, "smoke");
    } finally {
      delete process.env.__proto__;
    }

    const env = mocks.exec.mock.calls[0]?.[0].env as Record<string, string>;
    expect(Object.hasOwn(env, "__proto__")).toBe(false);
    expect(env.ORACLE_DIR).toBe("/repo/evals/smoke/oracle");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-eval/src/run/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the exported oracle verification API starts its command without the ambient `__proto__` variable. Remove the disposable probe after validation.

## Observed Behavior

After adding an own enumerable `__proto__ = "visible"` property to `process.env`, a call to exported `verifyOracle()` invokes its mocked host runner with an `env` object that owns `ORACLE_DIR` but does not own `__proto__`. In `packages/agent-eval/src/run/oracle.ts`, `createOracleEnv()` loops over ambient environment entries and copies each into `env = {}` through `env[key] = value`; the `__proto__` assignment invokes ordinary object prototype semantics instead of preserving the variable for the verifier subprocess.

## Expected Behavior

Oracle verification commands should receive all ambient environment variables forwarded by `verifyOracle()`, including `__proto__`, or the API should reject unsupported environment variable names explicitly rather than silently dropping them during process specification creation.

## Impact

Verification commands can execute under an environment different from the embedding process without any warning. Projects that intentionally depend on an ambient value under this valid environment-variable name can produce misleading verification results because the verifier silently runs with missing input.
