# Agent harness tools run-log runner traversal escapes home log root

## Summary

The exported `resolveRunLogDir()` helper joins its caller-supplied `runner` string directly into `<homeDir>/.poe-code/logs/<runner>/<plan-slug>`. A runner value containing parent-directory segments escapes the intended Poe Code log root and returns a destination elsewhere on disk.

## Reproduction

Create a disposable probe at `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveRunLogDir } from "./run-logs.js";

describe("resolveRunLogDir runner containment", () => {
  it("allows runner names to escape the configured log root", () => {
    const result = resolveRunLogDir({
      homeDir: "/home/test",
      runner: "../../../outside",
      planPath: "/repo/docs/plans/review.md",
    });

    console.log(JSON.stringify({ result }));
    expect(result).toBe("/home/outside/review");
  });
});
```

Run the probe and delete it afterward:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm packages/agent-harness-tools/src/__probe__.test.ts
```

## Observed Behavior

The probe passes and prints a path outside the configured home state directory:

```text
{"result":"/home/outside/review"}
```

`resolveRunLogDir()` in `packages/agent-harness-tools/src/run-logs.ts` calculates the plan slug but performs no validation on `options.runner` before passing it as an intermediate component to `path.join()`. Normal path resolution collapses `../../../outside` out of `/home/test/.poe-code/logs` and returns `/home/outside/review`.

## Expected Behavior

A helper whose result is used as a per-run log directory under `<homeDir>/.poe-code/logs` should accept only a safe runner identifier, or validate that the resolved directory remains contained in the logging root. Traversal-bearing runner values should be rejected.

## Impact

Any consumer that allows a runner identifier to be influenced by configuration, extensions, or higher-level SDK input can route snapshots, transcripts, or other run artifacts outside Poe Code's designated logging state. This is a directory-selection escape independent of later `logFileName` traversal or symlink-based redirection issues.
