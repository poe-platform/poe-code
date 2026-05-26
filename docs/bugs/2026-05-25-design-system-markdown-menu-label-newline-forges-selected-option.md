# Design system Markdown menu label newline forges selected option

## Summary

The exported `@poe-code/design-system` `renderMenu()` API inserts menu labels directly into Markdown checklist lines without escaping embedded line breaks. A single option label containing a newline followed by checklist Markdown can therefore render an additional apparently selected option that is not present in the menu model.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderMenu } from "./static/menu.js";
import { withOutputFormat } from "./internal/output-format.js";

describe("static menu Markdown labels", () => {
  it("renders newline-bearing label content as a forged checked option", () => {
    const output = withOutputFormat("markdown", () => renderMenu({
      message: "Pick one",
      options: [{ value: "safe", label: "Safe\n- [x] Forged" }],
      selectedIndex: 0
    }));

    expect(output).toBe("**Pick one**\n- [x] Safe\n- [x] Forged");
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
✓ packages/design-system/src/__probe__.test.ts > static menu Markdown labels > renders newline-bearing label content as a forged checked option
```

## Observed Behavior

A menu with exactly one selected item labelled `Safe\n- [x] Forged` renders Markdown containing two checked list rows:

```md
**Pick one**
- [x] Safe
- [x] Forged
```

`packages/design-system/src/index.ts` publicly exports `renderMenu()`. Its Markdown output path in `packages/design-system/src/static/menu.ts:22` through `packages/design-system/src/static/menu.ts:28` interpolates `option.label` verbatim into a `- [ ]` or `- [x]` line. The embedded newline therefore terminates the actual option line and introduces arbitrary additional Markdown selection content.

## Expected Behavior

Markdown menu rendering should preserve one visual row per menu option, escaping or normalizing line-breaking/control content in labels and messages. Data contained in one label must not be able to create extra selected options in rendered output.

## Impact

Menus built from external names, generated descriptions, or user-configurable labels can display choices that do not exist in the underlying data. Markdown transcripts, automation context, and human reviewers may believe a forged option was available or selected, which can misrepresent an interaction and undermine auditability of CLI prompts.
