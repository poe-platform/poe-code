---
name: "GitHub Workflows Variables Generation Drops a `__proto__` User Override"
---

# GitHub Workflows Variables Generation Drops a `__proto__` User Override

## Summary

The exported `generateProjectVariablesFile()` API silently removes an existing user-authored workflow variable named `__proto__` when regenerating `variables.yaml`. The regeneration path parses accepted YAML and copies variable names into plain objects, causing the special key to alter an intermediate prototype rather than remain a serializable override.

## Reproduction

Create a disposable Vitest probe at `packages/github-workflows/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateProjectVariablesFile } from "./variables.js";

describe("workflow generated variables special names", () => {
  it("drops an explicit __proto__ custom variable from generated YAML", () => {
    const content = generateProjectVariablesFile({}, "__proto__: visible\n");

    expect(content).not.toContain("__proto__");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/github-workflows/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that regeneration removes the valid input variable. Remove the disposable probe after validation.

## Observed Behavior

Calling `generateProjectVariablesFile({}, "__proto__: visible\n")` returns the generated header followed by no `__proto__` override. The original YAML input is accepted without error, but `normalizeVariables()` writes each parsed key into `const result = {}` and `extractUserOverrideBlocks()` similarly stores blocks in `const blocks = {}` before generation iterates their own enumerable entries.

## Expected Behavior

Regenerating a workflow variables file should preserve every valid user-authored variable override, including a key named `__proto__`, or reject unsupported key names before discarding content.

## Impact

Running workflow variables regeneration can silently delete a user's persisted configuration entry. A project that relies on that key loses the override without a validation error, making configuration refresh operations lossy and difficult to audit.
