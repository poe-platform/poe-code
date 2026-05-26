# Agent Script Raw CLI Drops a `__proto__` Caller Module Before Execution

## Summary

The exported Agent Script `runCli()` API accepts a caller module registry containing a module named `__proto__`, but silently loses that module when executing a raw `.ajs` script. The script then fails with an unknown-module error even though the module was supplied through the public `modulesFor` extension point.

## Reproduction

Create a disposable Vitest probe at `packages/agent-script/src/__probe__.test.ts`:

```ts
import { vol } from "memfs";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { runCli } = await import("./cli.js");

describe("agent-script raw CLI prototype-key module repro", () => {
  it("drops a supplied __proto__ module before executing a raw script", async () => {
    vol.reset();
    vol.mkdirSync("/repo", { recursive: true });
    vol.writeFileSync(
      "/repo/script.ajs",
      'import { value } from "__proto__";\nreturn value;\n'
    );
    const stderr: string[] = [];

    const exitCode = await runCli(["script.ajs"], {
      cwd: "/repo",
      modulesFor: () => Object.fromEntries([["__proto__", { value: "visible" }]]) as never,
      stdout: { write: () => undefined },
      stderr: { write: (chunk) => stderr.push(chunk) }
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("Unknown module '__proto__'");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-script/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that a supplied module is absent by the time raw-script imports are resolved. Remove the disposable probe after validation.

## Observed Behavior

Calling `runCli(["script.ajs"], { modulesFor: () => Object.fromEntries([["__proto__", { value: "visible" }]]) })` for a raw script that imports from `"__proto__"` returns runtime exit code `1` and reports `Unknown module '__proto__'`. In `packages/agent-script/src/cli.ts`, raw scripts pass their runtime registry through `excludeHarnessModule()`, which creates `rawModules = {}` and assigns each non-`harness` module with `rawModules[moduleName] = moduleExports`. The accepted `__proto__` module is therefore not retained as an own registry entry before module resolution.

## Expected Behavior

Raw Agent Script execution should preserve every caller-provided module registry entry except the explicitly excluded `harness` module, including a data key named `__proto__`, or reject unsupported module identifiers when accepting the registry.

## Impact

Hosts extending raw Agent Script execution with custom modules can observe runtime failures only for special module names even though registration succeeds. Scripts that depend on a supplied module fail unexpectedly, making the public module-injection API inconsistent across `.md` and raw `.ajs` execution modes.
