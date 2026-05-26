# Design system terminal markdown cyclic frontmatter crashes render

## Summary

The exported `@poe-code/design-system` `render()` API accepts public Markdown AST nodes whose frontmatter values are typed as arbitrary unknown data, but the visible-frontmatter renderer calls `JSON.stringify()` on structured values without handling cycles. Rendering an AST containing cyclic frontmatter with `showFrontmatter: true` throws instead of producing output or safely representing the unsupported value.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { render } from "./terminal-markdown/index.js";

describe("terminal markdown cyclic frontmatter", () => {
  it("throws while rendering a cyclic frontmatter value", () => {
    const metadata: { self?: unknown } = {};
    metadata.self = metadata;

    expect(() => render({
      type: "root",
      children: [{ type: "frontmatter", data: { metadata } }]
    }, { showFrontmatter: true })).toThrowError(/circular/i);
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
✓ packages/design-system/src/__probe__.test.ts > terminal markdown cyclic frontmatter > throws while rendering a cyclic frontmatter value
```

## Observed Behavior

Calling public `render()` with a root containing `{ type: "frontmatter", data: { metadata: cyclicObject } }` and `{ showFrontmatter: true }` throws a `TypeError` for a circular JSON structure, yielding no rendered terminal Markdown output.

`packages/design-system/src/index.ts` exports `render` as part of the public terminal-Markdown API. When displayed frontmatter is enabled, `renderFrontmatter()` enumerates AST frontmatter entries at `packages/design-system/src/terminal-markdown/renderer.ts:310` through `packages/design-system/src/terminal-markdown/renderer.ts:323`. For values other than strings, numbers, booleans, or `null`, `formatFrontmatterValue()` returns `JSON.stringify(value)` directly at `packages/design-system/src/terminal-markdown/renderer.ts:325` through `packages/design-system/src/terminal-markdown/renderer.ts:338`, which throws synchronously for a cyclic value allowed by the public `Record<string, unknown>` node shape.

## Expected Behavior

Rendering a public Markdown AST should not crash on structured frontmatter data that cannot be serialized. The renderer should either safely substitute or omit cyclic values, or validate and reject unsupported AST values with a deliberate, user-facing error before beginning rendering.

## Impact

Consumers using the public AST renderer for generated documents, interactive previews, or metadata-rich UI can crash the rendering flow merely by including a cyclic metadata object. A display-only operation becomes a failure point and can prevent surrounding plan or documentation content from being shown.
