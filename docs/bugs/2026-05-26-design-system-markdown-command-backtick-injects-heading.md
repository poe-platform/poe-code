# Design system Markdown command backtick injects heading

## Summary

The public `@poe-code/design-system` `text.command()` helper renders Markdown command text by wrapping content in a single pair of backticks without escaping delimiters or line breaks. A command value containing a backtick and newline can therefore close the intended inline-code span and emit an independent forged heading.

## Reproduction

Create the disposable probe `packages/design-system/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { text, withOutputFormat } from "./index.js";

describe("markdown command delimiter", () => {
  it("lets command content close code and inject a heading", () => {
    const output = withOutputFormat("markdown", () =>
      text.command("safe`\n\n## FORGED")
    );

    console.log(JSON.stringify(output));
    expect(output).toBe("`safe`\n\n## FORGED`");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
```

Result:

```text
"`safe`\n\n## FORGED`"
✓ packages/design-system/src/__probe__.test.ts > markdown command delimiter > lets command content close code and inject a heading
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`packages/design-system/src/index.ts` publicly exports the `text` helper object. In `packages/design-system/src/components/text.ts`, `text.command()` returns `` `\`${content}\`` `` in Markdown mode without escaping embedded backticks or newline content. For `"safe`\n\n## FORGED"`, the initial backtick closes immediately after `safe`, and the following line is rendered as an independent Markdown heading rather than command text.

## Expected Behavior

Command content rendered as Markdown should remain within its intended code representation. Embedded delimiters and line breaks should be escaped or rendered using a safe code-span/block form so command strings cannot introduce arbitrary Markdown structure.

## Impact

CLIs and reports that present command names or command fragments supplied by plugins, remote tools, or parsed input can display attacker-controlled headings as trusted documentation or status text. This can make generated guidance misleading and obscure the actual command value being shown.
