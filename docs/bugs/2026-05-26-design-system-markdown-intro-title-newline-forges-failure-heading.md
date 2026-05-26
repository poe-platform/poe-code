# Design system Markdown intro title newline forges failure heading

## Summary

The public `@poe-code/design-system` prompt `intro()` renderer interpolates its title directly into a Markdown heading. A title containing line breaks can therefore close the intended document heading and emit a new heading with attacker-supplied status text, such as a fabricated failure message.

## Reproduction

Create the disposable probe `packages/design-system/src/prompts/primitives/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { withOutputFormat } from "../../internal/output-format.js";
import { intro } from "./intro.js";

describe("markdown intro embedded newline", () => {
  it("lets one intro title forge a separate failure heading", () => {
    const chunks: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);

    try {
      withOutputFormat("markdown", () => {
        intro("Setup\n\n## Failed: delete project");
      });
    } finally {
      write.mockRestore();
    }

    const output = chunks.join("");
    console.log(JSON.stringify(output));
    expect(output).toBe("# Setup\n\n## Failed: delete project\n\n");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/design-system/src/prompts/primitives/__probe__.test.ts --reporter verbose
```

Result:

```text
"# Setup\n\n## Failed: delete project\n\n"
✓ packages/design-system/src/prompts/primitives/__probe__.test.ts > markdown intro embedded newline > lets one intro title forge a separate failure heading
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`packages/design-system/src/index.ts` publicly exports `intro()` through the prompts API. In `packages/design-system/src/prompts/primitives/intro.ts`, the Markdown rendering branch writes `` `# ${stripAnsi(title)}\n\n` ``. `stripAnsi()` removes terminal escape sequences but does not contain Markdown syntax or newline characters, so the supplied title renders as one legitimate `# Setup` heading followed by a separate `## Failed: delete project` heading.

## Expected Behavior

An intro title should render as one contained title value in Markdown output. Embedded newlines and Markdown heading delimiters should be escaped, normalized, or otherwise prevented from introducing independent status-looking headings.

## Impact

Callers that display user-, plan-, plugin-, or workflow-derived titles through Markdown prompt output can emit fabricated headings as though they were trusted UI state. Rendered transcripts and reports may misleadingly claim failures or instructions that the application never generated.
