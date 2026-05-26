# Design system terminal markdown NaN width drops paragraph text

## Summary

The exported `@poe-code/design-system` `render()` API accepts an optional numeric width without validating that it is finite. Passing `width: NaN` causes ordinary paragraph content to disappear completely, returning an empty rendered string rather than either using a safe width or rejecting the invalid layout input.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { render } from "./terminal-markdown/index.js";

describe("terminal markdown NaN width", () => {
  it("drops ordinary paragraph text when width is NaN", () => {
    expect(render({
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", value: "hello" }] }]
    }, { width: Number.NaN })).toBe("");
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
✓ packages/design-system/src/__probe__.test.ts > terminal markdown NaN width > drops ordinary paragraph text when width is NaN
```

## Observed Behavior

Rendering a public AST containing a single `hello` paragraph with `{ width: NaN }` returns the empty string, omitting all user-visible paragraph text without an error.

`packages/design-system/src/index.ts` publicly exports `render()`. The renderer computes its layout width as `Math.max(1, options.width ?? process.stdout.columns ?? widths.maxLine)` at `packages/design-system/src/terminal-markdown/renderer.ts:36` through `packages/design-system/src/terminal-markdown/renderer.ts:42`; `Math.max(1, NaN)` remains `NaN`. Text wrapping later calls `splitWord(token.value, width)` at `packages/design-system/src/terminal-markdown/renderer.ts:609` through `packages/design-system/src/terminal-markdown/renderer.ts:678`. Both the comparison `value.length <= NaN` and the loop progression `index += NaN` fail to produce a text chunk, so the paragraph renders as no output.

## Expected Behavior

The renderer should reject non-finite width values or fall back to a valid positive width before laying out content. An invalid layout option must not silently remove Markdown content from the rendered result.

## Impact

Callers that derive terminal width from parsed configuration, transport values, or unavailable measurements can display empty previews for nonempty Markdown documents while receiving no error. Plan summaries, prompt previews, and CLI documentation can appear blank, hiding meaningful content and misleading both users and automation.
