# Design system Markdown stopped spinner newline forges error item

## Summary

The public `@poe-code/design-system` `renderSpinnerStopped()` API interpolates its message directly into a Markdown list item. A successful stopped-spinner message containing a newline can therefore add a second list item formatted as a failure, making generated Markdown falsely appear to report an error after successful completion.

## Reproduction

Create the disposable probe `packages/design-system/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderSpinnerStopped } from "./static/spinner.js";
import { withOutputFormat } from "./internal/output-format.js";

describe("markdown stopped spinner embedded newline", () => {
  it("lets one successful completion forge an error list item", () => {
    const output = withOutputFormat("markdown", () =>
      renderSpinnerStopped({ message: "Done\n- **error:** deploy failed", code: 0 })
    );

    console.log(JSON.stringify(output));
    expect(output).toBe("- Done\n- **error:** deploy failed\n");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
```

Result:

```text
"- Done\n- **error:** deploy failed\n"
✓ packages/design-system/src/__probe__.test.ts > markdown stopped spinner embedded newline > lets one successful completion forge an error list item
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`packages/design-system/src/index.ts` publicly exports `renderSpinnerStopped()`. Its Markdown branch in `packages/design-system/src/static/spinner.ts` returns a list line using the uncontained message value: `` `- ${options.message}${options.timer ? ` [${options.timer}]` : ""}\n` ``. Supplying `{ message: "Done\n- **error:** deploy failed", code: 0 }` produces one successful completion line followed by a standalone failure-looking list item, even though the stopped spinner's status code is success.

## Expected Behavior

A stopped-spinner message should occupy one contained Markdown status item. Embedded line breaks and list markup should be escaped or normalized so a successful spinner completion cannot introduce an independent error-shaped output record.

## Impact

Callers rendering progress completion messages derived from tasks, tools, or remote output can generate Markdown transcripts that falsely claim failed work. This undermines status summaries and agent-readable reports because forged failure records appear alongside genuine successful spinner completion.
