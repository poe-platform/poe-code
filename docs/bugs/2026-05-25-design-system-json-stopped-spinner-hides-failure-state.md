# Design system JSON stopped spinner hides failure state

## Summary

The exported `@poe-code/design-system` `renderSpinnerStopped()` API uses its `code` field to distinguish success from failure in terminal rendering, but its JSON output omits both `code` and `subtext`. A stopped spinner with a nonzero failure code therefore serializes identically to a successful stopped spinner.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderSpinnerStopped } from "./static/spinner.js";
import { withOutputFormat } from "./internal/output-format.js";

describe("static spinner JSON failure state", () => {
  it("serializes a failed stopped spinner identically to success", () => {
    const succeeded = withOutputFormat("json", () =>
      renderSpinnerStopped({ message: "Done", code: 0 })
    );
    const failed = withOutputFormat("json", () =>
      renderSpinnerStopped({ message: "Done", code: 17, subtext: "command failed" })
    );

    expect(failed).toBe(succeeded);
    expect(JSON.parse(failed)).toEqual({ type: "spinner", state: "stopped", message: "Done" });
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
✓ packages/design-system/src/__probe__.test.ts > static spinner JSON failure state > serializes a failed stopped spinner identically to success
```

## Observed Behavior

`renderSpinnerStopped({ message: "Done", code: 0 })` and `renderSpinnerStopped({ message: "Done", code: 17, subtext: "command failed" })` produce the same JSON line:

```json
{"type":"spinner","state":"stopped","message":"Done"}
```

In terminal mode, the same implementation uses `code === 0` to draw a green success glyph or a red failure glyph and renders `subtext` for failure detail. In the JSON branch at `packages/design-system/src/static/spinner.ts:51` through `packages/design-system/src/static/spinner.ts:57`, the object contains only the generic stopped state, message, and optional timer; it drops the fields that distinguish a failed completion.

## Expected Behavior

Machine-readable stopped-spinner output should preserve whether the operation succeeded or failed and include relevant failure detail when provided, so it expresses the same outcome available in terminal rendering. A nonzero `code` must not serialize indistinguishably from `code: 0`.

## Impact

JSON consumers, log processors, snapshots, and automation cannot distinguish successful completion from failed completion when status is conveyed through the static spinner API. Failures can be presented as ordinary stopped operations with lost diagnostics, leading downstream tooling to overlook or misreport errors.
