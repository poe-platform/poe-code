# Design system static menu NaN selection serializes as null

## Summary

The exported `@poe-code/design-system` `renderMenu()` API accepts a numeric `selectedIndex` without validating that it is a finite usable index. Supplying `selectedIndex: NaN` causes rendered menu views to select no option, while JSON output silently serializes the invalid numeric selection as `null`, changing the input value and producing a contradictory successful menu representation.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderMenu } from "./static/menu.js";
import { withOutputFormat } from "./internal/output-format.js";

describe("static menu nonfinite selection", () => {
  it("serializes NaN selectedIndex as null while selecting no row", () => {
    const markdown = withOutputFormat("markdown", () => renderMenu({
      message: "Pick one",
      options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
      selectedIndex: Number.NaN
    }));
    const json = withOutputFormat("json", () => renderMenu({
      message: "Pick one",
      options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
      selectedIndex: Number.NaN
    }));

    expect(markdown).toBe("**Pick one**\n- [ ] A\n- [ ] B");
    expect(JSON.parse(json)).toMatchObject({ selected: null });
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
rm -f packages/design-system/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/design-system/src/__probe__.test.ts > static menu nonfinite selection > serializes NaN selectedIndex as null while selecting no row
```

## Observed Behavior

For two available options and `selectedIndex: NaN`, Markdown output has no checked item:

```md
**Pick one**
- [ ] A
- [ ] B
```

The same call in JSON mode returns an apparently valid serialized menu with `"selected": null`, although `null` was never supplied by the caller.

`packages/design-system/src/index.ts` publicly exports `renderMenu()`. The implementation assigns `const selectedIndex = opts.selectedIndex ?? 0` and compares each integer row index against it at `packages/design-system/src/static/menu.ts:18` through `packages/design-system/src/static/menu.ts:28`; no row equals `NaN`. Its JSON branch includes the same non-finite value at `packages/design-system/src/static/menu.ts:31` through `packages/design-system/src/static/menu.ts:37`, where `JSON.stringify()` serializes `NaN` as `null`.

## Expected Behavior

Menu rendering should reject or normalize non-finite selection indexes before output generation. Markdown and JSON modes should describe the same meaningful selection state and should not silently turn an invalid numeric value into `null`.

## Impact

SDK consumers that compute a selection index from parsed or missing numeric state can silently render a menu with no active choice while downstream JSON consumers see `null` rather than an actionable error. This masks state corruption, produces inconsistent output across formats, and can mislead automation examining prompt snapshots.
