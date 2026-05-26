# Plan browser labels plans from headings inside fenced code

## Summary

`@poe-code/plan-browser` derives titles for ordinary Markdown plan documents by scanning trimmed lines for the first `# ` prefix, without parsing Markdown structure. If a plan includes a fenced example containing an H1 before its real heading, the browser labels and details the plan using the example text rather than the document title.

## Reproduction

From the repository root, run a disposable Vitest probe through the public metadata formatter:

```sh
cat > packages/plan-browser/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { readPlanMetadata } from "./format.js";

describe("plan browser markdown title extraction", () => {
  it("labels a plan from a fenced example heading instead of its actual heading", async () => {
    const content = [
      "```md",
      "# Example from docs",
      "```",
      "",
      "# Actual Plan Title",
      "",
      "Do the work."
    ].join("\n");
    const metadata = await readPlanMetadata({
      kind: "plan",
      absolutePath: "/repo/docs/plans/probe.md",
      path: "docs/plans/probe.md",
      fs: { readFile: async () => content }
    });
    console.log(JSON.stringify(metadata));
    expect(metadata).toEqual({
      title: "Example from docs",
      detail: "Example from docs",
      format: "markdown"
    });
  });
});
EOF
trap 'rm -f packages/plan-browser/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
nl -ba packages/plan-browser/src/format.ts | sed -n '204,214p;303,365p'
nl -ba packages/plan-browser/README.md | sed -n '1,16p'
```

## Observed Behavior

The metadata used for the browser row chooses the code sample's heading rather than the actual plan heading:

```text
{"title":"Example from docs","detail":"Example from docs","format":"markdown"}
✓ packages/plan-browser/src/__probe__.test.ts > plan browser markdown title extraction > labels a plan from a fenced example heading instead of its actual heading
```

The package advertises normalized plan discovery and per-source detail formatting in `packages/plan-browser/README.md:9`. For Markdown plans, `extractFirstHeading()` simply trims every source line and chooses the first string beginning with `# ` in `packages/plan-browser/src/format.ts:204`; it does not exclude fenced code blocks. `readPlanMetadata()` then assigns that value to both the displayed `title` and `detail` for ordinary plans in `packages/plan-browser/src/format.ts:355`.

## Expected Behavior

Plan titles should be derived from actual Markdown heading nodes outside code fences. A fenced documentation example should remain body content, while this document should appear in the browser as `Actual Plan Title`.

## Impact

Plans commonly include Markdown examples, prompt templates, or generated-document samples before later implementation headings. The browser can display the wrong plan identity in its list and detail text, making users select, edit, archive, or delete a different document than they intended based on misleading labels.
