# Plan browser CR-only heading absorbs body into plan title

## Summary

`@poe-code/plan-browser` extracts ordinary Markdown plan titles by splitting input only on line-feed (`\n`) characters. For a valid CR-only (`\r`) design document, the first H1 line remains joined to the following body paragraph, so both the displayed `title` and `detail` include unrelated document body text instead of only the heading.

## Reproduction

Create a disposable Vitest probe at `packages/plan-browser/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readPlanMetadata } from "./format.js";

describe("plan-browser CR-only ordinary plan title", () => {
  it("extracts only the H1 title from a CR-only markdown design document", async () => {
    const metadata = await readPlanMetadata({
      kind: "plan",
      absolutePath: "/repo/docs/plans/feature.md",
      path: "docs/plans/feature.md",
      fs: {
        async readFile() {
          return ["# Feature", "", "Body paragraph."].join("\r");
        }
      }
    });

    expect(metadata).toMatchObject({
      title: "Feature",
      detail: "Feature"
    });
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
rm -f packages/plan-browser/src/__probe__.test.ts
```

## Observed Behavior

The probe fails because the ordinary-plan label incorporates the body paragraph:

```text
FAIL  packages/plan-browser/src/__probe__.test.ts > plan-browser CR-only ordinary plan title > extracts only the H1 title from a CR-only markdown design document

- Expected
+ Received

  {
-   "detail": "Feature",
-   "title": "Feature",
+   "detail": "Feature\r\rBody paragraph.",
+   "title": "Feature\r\rBody paragraph.",
  }
```

`extractFirstHeading()` in `packages/plan-browser/src/format.ts:203` calls `content.split("\n")`, so a CR-only document is treated as a single logical line. Since that combined value begins with `# `, the function strips only the heading marker and returns the remaining heading plus paragraph content. `readPlanMetadata()` reuses that string for both `title` and `detail` at `packages/plan-browser/src/format.ts:355`, and discovery subsequently exposes the corrupted display metadata in `packages/plan-browser/src/discovery.ts:148`.

## Expected Behavior

Ordinary Markdown plan title extraction should recognize line boundaries consistently for valid newline styles, including CR-only text, and return only the first heading's text. If CR-only Markdown is unsupported, the browser should reject it instead of creating corrupted visible labels.

## Impact

Design documents saved with CR-only line endings can appear in plan listings with multiline body content embedded in their title and subtitle. This degrades navigation, leaks potentially lengthy or sensitive body text into summary rows, and makes it difficult for users to identify the intended plan from the browser display.
