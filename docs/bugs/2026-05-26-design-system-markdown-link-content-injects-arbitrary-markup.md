# Design system Markdown link content injects arbitrary markup

## Summary

The exported `text.link()` renderer uses the same caller-supplied string as both Markdown label and destination without escaping Markdown delimiters or line breaks. A link value containing newlines and Markdown syntax can therefore inject additional rendered content into Markdown output.

## Reproduction

Create a disposable probe at `packages/design-system/src/components/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { withOutputFormat } from "../internal/output-format.js";
import { text } from "./text.js";

describe("markdown link rendering", () => {
  it("lets link content close the destination and append arbitrary markdown", () => {
    const output = withOutputFormat("markdown", () =>
      text.link("safe)\n\n**FORGED**")
    );

    console.log(JSON.stringify({ output }));
    expect(output).toBe("[safe)\n\n**FORGED**](safe)\n\n**FORGED**)");
  });
});
```

Run the probe and delete it afterward:

```sh
npm exec -- vitest run packages/design-system/src/components/__probe__.test.ts --reporter verbose
rm packages/design-system/src/components/__probe__.test.ts
```

## Observed Behavior

The probe passes and shows injected bold Markdown content outside the intended inline link structure:

```text
{"output":"[safe)\n\n**FORGED**](safe)\n\n**FORGED**)"}
```

`text.link()` in `packages/design-system/src/components/text.ts` emits Markdown using `` `[${content}](${content})` ``. It does not escape closing delimiters, whitespace, or line breaks in either position, so supplied content becomes raw Markdown structure rather than a contained URL display value.

## Expected Behavior

Markdown-format link rendering should safely encode or reject values that cannot be represented as one inline link. A URL string must not be able to introduce new paragraphs, emphasis, or other arbitrary Markdown records into surrounding output.

## Impact

CLI output and generated documents that render externally sourced authorization URLs, repository links, or plugin-provided links through this helper can display attacker-controlled Markdown as trusted UI content. The defect affects Markdown output independently of terminal line-injection and menu rendering paths.
