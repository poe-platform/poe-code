# Toolcraft markdown table missing constructor cell renders inherited function

## Summary

Toolcraft's automatic Markdown table renderer populates an absent `constructor` column cell with `Object.prototype.constructor` instead of leaving the sparse cell empty. A result array containing one explicit `constructor` field can therefore make unrelated rows render inherited JavaScript function source as returned tool data.

## Reproduction

From the repository root, add a disposable probe at `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, type RenderPrimitives } from "./index.js";
import { renderResult } from "./renderer.js";

describe("toolcraft markdown inherited table cells", () => {
  it("renders an inherited constructor value into a missing result cell", () => {
    const command = defineCommand({
      name: "demo",
      params: S.Object({}),
      handler: async () => undefined,
    });
    const primitives = {
      logger: {} as RenderPrimitives["logger"],
      renderTable: vi.fn(),
      getTheme: vi.fn(),
      note: vi.fn(),
    } as unknown as RenderPrimitives;
    let stdout = "";

    renderResult(
      command,
      [JSON.parse('{"constructor":"provided"}'), {}],
      "md",
      primitives,
      (chunk) => { stdout += chunk; }
    );

    expect(stdout).toContain("| provided |");
    expect(stdout).toContain("function Object() { [native code] }");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/toolcraft/src/__probe__.test.ts > toolcraft markdown inherited table cells > renders an inherited constructor value into a missing result cell
```

Remove the disposable probe after running it.

## Observed Behavior

Rendering `[JSON.parse('{"constructor":"provided"}'), {}]` in Markdown mode emits the supplied first-row value and also emits `function Object() { [native code] }` for the second row's missing cell. `getColumnNames()` in `packages/toolcraft/src/renderer.ts` correctly discovers only own row keys, but `renderArrayMarkdown()` tests each cell with `name in row`, so a missing own `constructor` property is read through the normal object prototype.

## Expected Behavior

Sparse table cells should be populated only from own properties of each result row. If a row does not contain an own `constructor` key, the cell should be empty rather than displaying inherited JavaScript values.

## Impact

Tool output rendered through the documented Markdown mode can include fabricated cell values that were not returned by a command or MCP tool. This corrupts tabular output and can mislead consumers of generated Markdown reports or CLI captures.
