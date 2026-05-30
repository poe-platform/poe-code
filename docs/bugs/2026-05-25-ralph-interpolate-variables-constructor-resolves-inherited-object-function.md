---
name: "Ralph interpolate variables constructor resolves inherited object function"
---

# Ralph interpolate variables constructor resolves inherited object function

## Summary

The exported `@poe-code/ralph` `interpolateVariables()` API replaces an unset `{{ constructor }}` placeholder with the inherited `Object.prototype.constructor` function text instead of leaving an unknown variable untouched. Templates can therefore receive content that was never provided in the caller's variable map.

## Reproduction

From the repository root, add a disposable probe at `packages/ralph/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { interpolateVariables } from "./variables/variables.js";

describe("ralph inherited interpolation keys", () => {
  it("replaces an unset constructor variable from Object.prototype", () => {
    const result = interpolateVariables("Hello {{ constructor }}", {});

    expect(result).not.toBe("Hello {{ constructor }}");
    expect(result).toContain("function Object() { [native code] }");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/ralph/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/ralph/src/__probe__.test.ts > ralph inherited interpolation keys > replaces an unset constructor variable from Object.prototype
```

Remove the disposable probe after running it.

## Observed Behavior

`interpolateVariables("Hello {{ constructor }}", {})` returns output containing `function Object() { [native code] }`, despite the variables object having no own `constructor` entry. `packages/ralph/src/variables/variables.ts` performs the replacement with `name in variables`, which considers inherited JavaScript prototype members to be supplied template variables.

## Expected Behavior

Only own entries explicitly supplied in the variable map should replace placeholders. An unset variable such as `constructor` should remain as `{{ constructor }}`, matching the existing unknown-variable behavior.

## Impact

User-authored Ralph prompts and documents can be rendered with unexpected inherited function source whenever they contain a special placeholder name. This corrupts generated prompts and violates the public interpolation API's distinction between supplied and unknown variables.
