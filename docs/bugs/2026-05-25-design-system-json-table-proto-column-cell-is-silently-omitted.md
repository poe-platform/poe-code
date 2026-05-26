# Design system JSON table proto column cell is silently omitted

## Summary

The public `@poe-code/design-system` `renderTable()` API silently omits a declared `__proto__` column when rendering tables in JSON output mode. Even when the input row owns a visible string value for that column, the serialized JSON row is `{}` rather than containing the declared cell.

## Reproduction

From the repository root, add a disposable probe at `packages/design-system/src/components/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { withOutputFormat } from "../internal/output-format.js";
import { renderTable } from "./table.js";

describe("table special column names", () => {
  it("drops a declared __proto__ cell from JSON table output", () => {
    const output = withOutputFormat("json", () => renderTable({
      theme: {
        border: (value: string) => value,
        header: (value: string) => value,
        muted: (value: string) => value,
      } as never,
      columns: [{ name: "__proto__", title: "Special", alignment: "left", maxLen: 8 }],
      rows: [JSON.parse('{"__proto__":"visible"}')],
    }));

    expect(output).toBe("[\n  {}\n]");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/design-system/src/components/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/design-system/src/components/__probe__.test.ts > table special column names > drops a declared __proto__ cell from JSON table output
```

Remove the disposable probe after running it.

## Observed Behavior

Rendering a table whose sole column is named `__proto__` and whose source row owns `"__proto__": "visible"` returns JSON text for an empty object row. `renderTableJson()` in `packages/design-system/src/components/table.ts` creates each normalized output row as `{}` and populates columns with `obj[col.name] = stripAnsi(row[col.name] ?? "")`. Assignment to the accepted `__proto__` column changes the temporary row object's prototype rather than creating a serializable own cell.

## Expected Behavior

JSON table rendering should serialize every declared column value as an own JSON field, including a column name such as `__proto__`, or explicitly reject unsupported column names. A visible input cell must not disappear solely because of JavaScript object-key semantics.

## Impact

Machine-readable table output can silently lose data while terminal and Markdown consumers may see the column value. This creates format-dependent corruption for CLI JSON consumers, scripts, and captured output that rely on `renderTable()` preserving declared tabular fields.
