# Design system Markdown table column title pipe adds header cell

## Summary

The public `@poe-code/design-system` `renderTable()` Markdown renderer escapes pipe delimiters in row cells but not in column titles. A column title containing `|` therefore expands into multiple rendered header cells while the alignment separator and data rows retain the original column count, producing a malformed and misleading Markdown table.

## Reproduction

Create the disposable probe `packages/design-system/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderTable, withOutputFormat, light } from "./index.js";

describe("markdown table header delimiter", () => {
  it("lets one column title introduce an extra header cell", () => {
    const output = withOutputFormat("markdown", () => renderTable({
      theme: light,
      columns: [
        { name: "name", title: "Name | Forged", alignment: "left", maxLen: 30 },
        { name: "state", title: "State", alignment: "left", maxLen: 30 }
      ],
      rows: [{ name: "task", state: "done" }]
    }));

    console.log(output);
    expect(output).toContain("| Name | Forged | State |");
    expect(output.split("\n")[1]).toBe("| :--- | :--- |");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
```

Result:

```text
| Name | Forged | State |
| :--- | :--- |
| task | done |
✓ packages/design-system/src/__probe__.test.ts > markdown table header delimiter > lets one column title introduce an extra header cell
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`packages/design-system/src/index.ts` publicly exports `renderTable()`. The Markdown implementation in `packages/design-system/src/components/table.ts` builds the header as `` `| ${columns.map((c) => c.title).join(" | ")} |` ``, directly inserting column titles without escaping Markdown table separators. The data-row branch in the same function explicitly applies `.replace(/\|/g, "\\|")` to cell values, so the title `"Name | Forged"` yields a three-cell header over a two-column separator and two-cell data row.

## Expected Behavior

Markdown table column titles should be escaped using the same delimiter-containment rule as cell values. Accepted header text must not change the table's structural column count or make fabricated headings appear as independent columns.

## Impact

Tables rendered from plugin-provided schemas, command output metadata, or user-facing labels can misrepresent their column structure and associate values with incorrect headings. Human readers and agents consuming Markdown output may trust a forged header column or misinterpret which field a displayed value belongs to.
