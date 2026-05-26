# Design system Markdown log success newline forges error record

## Summary

The public `@poe-code/design-system` prompt `log.success()` renderer interpolates message text directly into Markdown list output without containing embedded line breaks. A single successful message containing a newline can therefore emit an additional line formatted as an independent failure record, making Markdown logs falsely report an error that never occurred.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/prompts/primitives/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { withOutputFormat } from "../../internal/output-format.js";
import { log } from "./log.js";

describe("markdown prompt log embedded newlines", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lets one success message forge a separate error item", () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    withOutputFormat("markdown", () => {
      log.success("Applied\n- **error:** forged failure");
    });

    expect(chunks.join("")).toBe("- **success:** Applied\n- **error:** forged failure\n");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/design-system/src/prompts/primitives/__probe__.test.ts --reporter verbose
rm -f packages/design-system/src/prompts/primitives/__probe__.test.ts
```

The probe passes:

```text
✓ packages/design-system/src/prompts/primitives/__probe__.test.ts > markdown prompt log embedded newlines > lets one success message forge a separate error item
```

## Observed Behavior

Rendering one successful prompt-log message whose content is `Applied\n- **error:** forged failure` in Markdown format writes two top-level Markdown records:

```md
- **success:** Applied
- **error:** forged failure
```

`packages/design-system/src/index.ts:42` through `packages/design-system/src/index.ts:44` publicly export `log` via the prompts API. In `packages/design-system/src/prompts/primitives/log.ts:88` through `packages/design-system/src/prompts/primitives/log.ts:102`, the Markdown `success()` path surrounds only the first prefix and trailing newline, interpolating `stripAnsi(msg)` verbatim inside the output. `stripAnsi()` removes terminal styling but does not make embedded Markdown lines part of the original log item, allowing supplied message text to create an unrelated error-shaped record.

## Expected Behavior

Markdown prompt logging should preserve a multiline success message as content belonging to that success event, or otherwise escape/reformat embedded lines so they cannot impersonate separate structured log records. One successful log operation must not render as an independent error event.

## Impact

Markdown output used in run reports, captured transcripts, CI summaries, or agent-readable evidence can contain false failure records sourced solely from success-message text. This makes audit output ambiguous and can cause users or automated consumers to interpret a successful operation as failed.
