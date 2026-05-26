# Agent Harness Resolve Pair Misreports Unreadable Script as Missing

## Summary

The exported `resolvePair()` helper converts every filesystem `stat()` failure while verifying a harness pair into `MissingPairError`, including permission failures. When a required `.ajs` file exists but is unreadable, callers receive a false missing-file diagnostic instead of the underlying access failure.

## Reproduction

Create the disposable probe `packages/agent-harness/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MissingPairError, resolvePair, type HarnessFs } from "./loader/pair.js";

describe("resolvePair unreadable harness file", () => {
  it("converts a permission error into a false missing-pair report", async () => {
    const fs: HarnessFs = {
      async stat(filePath) {
        if (filePath.endsWith("probe.md")) {
          return { isFile: () => true };
        }
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      }
    };

    await expect(resolvePair("/harnesses/probe/probe.md", fs)).rejects.toEqual(
      expect.objectContaining({ name: "MissingPairError", side: "ajs" })
    );
    await expect(resolvePair("/harnesses/probe/probe.md", fs)).rejects.toBeInstanceOf(MissingPairError);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-harness/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that a permission error for an expected harness side is surfaced as a missing-pair error. Remove the disposable probe after running it.

## Observed Behavior

When `stat("/harnesses/probe/probe.ajs")` throws an `EACCES` error, `resolvePair("/harnesses/probe/probe.md", fs)` rejects with `MissingPairError` identifying the `.ajs` side as missing. `resolvePair()` catches all exceptions from `fs.stat(check.path)` and unconditionally throws `new MissingPairError(...)` at `packages/agent-harness/src/loader/pair.ts:70` through `packages/agent-harness/src/loader/pair.ts:80`, without distinguishing absence from access, I/O, or adapter failures.

## Expected Behavior

Pair resolution should translate only genuine not-found or non-file conditions into `MissingPairError`; other filesystem failures should be preserved or wrapped with an accurate unreadable-pair diagnostic. Existing but inaccessible harness files should not be reported as absent.

## Impact

Permission changes, transient storage failures, or filesystem adapter faults can make a valid harness pair appear incomplete. Discovery may silently skip affected harnesses when it catches `MissingPairError`, and direct callers receive misleading remediation guidance to create a file that already exists rather than fixing the access problem.
