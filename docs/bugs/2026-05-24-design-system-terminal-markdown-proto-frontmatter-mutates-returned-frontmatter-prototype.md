# Design system terminal markdown proto frontmatter mutates returned frontmatter prototype

## Summary

The public `parse()` API exported by `@poe-code/design-system` parses YAML-like Markdown frontmatter into ordinary JavaScript objects using bracket assignment. A frontmatter key named `__proto__` mutates the prototype of the returned `frontmatter` record instead of being retained as normal parsed metadata.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/design-system/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { parse } from "./index.js";

describe("terminal markdown frontmatter reserved keys", () => {
  it("returns inherited properties from __proto__ frontmatter", () => {
    const parsed = parse(["---", "__proto__:", "  owner: attacker", "---", "", "# Demo"].join("\n"));
    const frontmatter = parsed.frontmatter!;
    console.log(JSON.stringify({ ownsProto: Object.hasOwn(frontmatter, "__proto__"), owner: (frontmatter as { owner?: string }).owner }));
    expect(Object.hasOwn(frontmatter, "__proto__")).toBe(false);
    expect((frontmatter as { owner?: string }).owner).toBe("attacker");
  });
});
PROBE
npm exec -- vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
rm packages/design-system/src/__probe__.test.ts
```

Output:

```text
{"ownsProto":false,"owner":"attacker"}
✓ packages/design-system/src/__probe__.test.ts > terminal markdown frontmatter reserved keys > returns inherited properties from __proto__ frontmatter
```

## Observed Behavior

`YamlSubsetParser.parseObject()` creates each parsed object as `{}` at `packages/design-system/src/terminal-markdown/parser/frontmatter.ts:45` through `packages/design-system/src/terminal-markdown/parser/frontmatter.ts:47`, then assigns parsed keys through `result[entry.key] = ...` at `packages/design-system/src/terminal-markdown/parser/frontmatter.ts:65` through `packages/design-system/src/terminal-markdown/parser/frontmatter.ts:73`. For `__proto__`, that assignment changes the object prototype. `extractFrontmatter()` returns the affected record at `packages/design-system/src/terminal-markdown/parser/frontmatter.ts:167` through `packages/design-system/src/terminal-markdown/parser/frontmatter.ts:218`, and `packages/design-system/src/index.ts:54` exposes it through the public `parse()` API.

## Expected Behavior

Frontmatter parsing should preserve permitted keys as own data properties, use a prototype-safe record representation, or reject dangerous mapping keys. Reading Markdown metadata must not create inherited values controlled by document content.

## Impact

Any consumer of the shared design-system Markdown parser, including downstream document readers, can receive attacker-controlled inherited metadata from an otherwise successfully parsed Markdown document. Callers that inspect optional fields or merge frontmatter into configuration/state may treat inherited values as trusted parsed input and make unsafe decisions.
