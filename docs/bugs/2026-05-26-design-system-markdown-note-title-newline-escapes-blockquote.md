# Design system Markdown note title newline escapes blockquote

## Summary

The public `@poe-code/design-system` prompt `note()` renderer prefixes only the first line of a Markdown note title as a blockquote. A title containing a newline can therefore emit an unquoted, top-level Markdown line, allowing one note heading to introduce a forged failure-looking list item outside the note container.

## Reproduction

Create the disposable probe `packages/design-system/src/prompts/primitives/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { withOutputFormat } from "../../internal/output-format.js";
import { note } from "./note.js";

describe("markdown note title embedded newline", () => {
  it("lets one note title forge an unquoted error item", () => {
    const chunks: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);

    try {
      withOutputFormat("markdown", () => {
        note("safe body", "Details\n- **error:** forged");
      });
    } finally {
      write.mockRestore();
    }

    const output = chunks.join("");
    console.log(JSON.stringify(output));
    expect(output).toBe("> **Details\n- **error:** forged**\n> safe body\n");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/design-system/src/prompts/primitives/__probe__.test.ts --reporter verbose
```

Result:

```text
"> **Details\n- **error:** forged**\n> safe body\n"
✓ packages/design-system/src/prompts/primitives/__probe__.test.ts > markdown note title embedded newline > lets one note title forge an unquoted error item
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`packages/design-system/src/index.ts` publicly exports `note()` through the prompts API. In `packages/design-system/src/prompts/primitives/note.ts`, the Markdown path builds a title heading as `` `> **${strippedTitle}**\n` `` but does not split and quote each title line. With a title of `"Details\n- **error:** forged"`, the output begins with a quoted title fragment, then emits `- **error:** forged**` as an independent top-level list item before returning to the quoted body line.

## Expected Behavior

Every line derived from a Markdown note title should remain within the note's blockquote structure, or multiline title input should be rejected or escaped. A title must not be able to introduce top-level Markdown records outside its containing note.

## Impact

Notes rendered from external status text, task metadata, or plugin labels can break out of their visual container and inject trusted-looking failure items into reports or transcripts. Readers and downstream agents may interpret forged top-level status content as application-generated output rather than untrusted note text.
