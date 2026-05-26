# Design system template renders inherited object members as view values

## Summary

The exported `renderTemplate()` helper treats inherited properties from `Object.prototype` as if they were provided template variables. Rendering `{{constructor}}` or `{{toString}}` against an empty view outputs `[object Object]` instead of behaving like an absent variable.

## Reproduction

Create a disposable probe at `packages/design-system/src/components/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderTemplate } from "./template.js";

describe("template inherited property lookup", () => {
  it("renders Object prototype members that were not supplied in the view", () => {
    const output = renderTemplate(
      "missing={{missing}} constructor={{constructor}} toString={{toString}}",
      {}
    );

    console.log(JSON.stringify({ output }));
    expect(output).toBe("missing= constructor=[object Object] toString=[object Object]");
  });
});
```

Run it and delete the disposable probe:

```sh
npm exec -- vitest run packages/design-system/src/components/__probe__.test.ts --reporter verbose
rm packages/design-system/src/components/__probe__.test.ts
```

## Observed Behavior

The probe passes and logs output for inherited fields despite the empty view:

```text
{"output":"missing= constructor=[object Object] toString=[object Object]"}
```

`lookupName()` in `packages/design-system/src/components/template.ts` delegates membership testing to `hasProperty()`, which uses `key in value`. That operator reports inherited prototype properties as present. `lookup()` then sends the inherited functions through `callLambda()`, invoking them with the empty view as `this`, and the resulting string is emitted as template content.

## Expected Behavior

Template variables should resolve only from values supplied by the view model, unless prototype lookup is explicitly documented and sandboxed. An empty plain-object view should render `{{constructor}}` and `{{toString}}` as missing values, not execute inherited functions.

## Impact

Templates consuming untrusted or externally authored placeholders can surface unintended runtime values and invoke inherited functions that were never configured as data. This corrupts generated configuration, prompts, or workflow text and creates a prototype-sensitive behavior distinct from data-layer merge or interpolation helpers elsewhere in the repository.
