# Agent eval exported schema mutation disables required judge validation

## Summary

The exported `@poe-code/agent-eval` `evalYamlSchema` object remains mutable and is the same schema object used internally by `validateEvalYaml()`. A consumer that inspects or customizes the exported schema can delete its required `judge` property, after which later evaluation documents that omit the required judge configuration are accepted as valid.

## Reproduction

Create the disposable probe `packages/agent-eval/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evalYamlSchema, validateEvalYaml } from "./index.js";

const missingJudgeDocument = {
  id: "schema-mutation",
  title: "Schema mutation",
  target: { repo: "https://example.com/repo.git", ref: "main" },
  oracle: {},
  budget: { max_iterations: 1, max_tokens: 100, wall_clock_ms: 1000 },
  weights: { tests: 1, judge: 0 }
};

describe("agent-eval exported validation schema mutation", () => {
  it("allows later eval files to omit a required judge block", () => {
    expect(() => validateEvalYaml(missingJudgeDocument, "before/eval.yaml"))
      .toThrow(/judge/);

    delete (evalYamlSchema.shape as Record<string, unknown>).judge;

    expect(validateEvalYaml(missingJudgeDocument, "after/eval.yaml")).toEqual(
      expect.objectContaining({ id: "schema-mutation" })
    );
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/agent-eval/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-eval/src/__probe__.test.ts
```

## Observed Behavior

The probe passes:

```text
✓ packages/agent-eval/src/__probe__.test.ts > agent-eval exported validation schema mutation > allows later eval files to omit a required judge block
```

Before mutation, `validateEvalYaml()` rejects `missingJudgeDocument` because it does not contain the required `judge` block. After deleting `evalYamlSchema.shape.judge`, validating the identical document succeeds.

`evalYamlSchema` defines `judge` as a required object in `packages/agent-eval/src/schema.ts:43` through `packages/agent-eval/src/schema.ts:84`, and `validateEvalYaml()` directly validates with that same object at `packages/agent-eval/src/schema.ts:98` through `packages/agent-eval/src/schema.ts:105`. The mutable singleton is exposed to package consumers from `packages/agent-eval/src/index.ts:1` through `packages/agent-eval/src/index.ts:6`.

## Expected Behavior

Public schema inspection must not be able to change the validation rules applied to subsequent eval documents. Either the exported schema must be deeply immutable, or `validateEvalYaml()` must validate against protected canonical schema state that cannot be mutated by external consumers.

## Impact

A plugin, CLI integration, test harness, or report generator that legitimately imports the exported schema can accidentally or intentionally weaken validation process-wide. Subsequent evaluation runs can load incomplete definitions without a required judge configuration, allowing malformed eval inputs past the package boundary and causing later execution or scoring behavior to diverge from the documented schema contract.
