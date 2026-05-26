# Agent Script CR-only frontmatter is silently treated as script body

## Summary

`@poe-code/agent-script` silently ignores YAML frontmatter when a Markdown harness uses standalone carriage-return (`\r`) line endings. The exported `splitFrontmatter()` function returns an empty metadata object and leaves the frontmatter delimiter and YAML content in the executable body rather than parsing the document metadata.

## Reproduction

Create a disposable Vitest probe at `packages/agent-script/src/loader/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "./frontmatter.js";

describe("CR-only frontmatter probe", () => {
  it("drops CR-only frontmatter instead of parsing it", () => {
    const markdown = "---\rtitle: Example\r---\r```js\rreturn true;\r```";

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: {},
      body: markdown
    });
  });
});
```

Run the focused probe, then remove it:

```sh
npm exec -- vitest run packages/agent-script/src/loader/__probe__.test.ts --reporter verbose
rm packages/agent-script/src/loader/__probe__.test.ts
```

Observed test output:

```text
✓ packages/agent-script/src/loader/__probe__.test.ts > CR-only frontmatter probe > drops CR-only frontmatter instead of parsing it
```

## Observed Behavior

`splitFrontmatter("---\rtitle: Example\r---\r```js\rreturn true;\r```")` returns `{ frontmatter: {}, body: markdown }`. The function is publicly exported at `packages/agent-script/src/index.ts:20`, and Markdown harness execution invokes it before locating the executable code fence at `packages/agent-script/src/cli.ts:359`. Although `findLineEnd()` already recognizes standalone `\r` separators, `readOpeningLineBreak()` at `packages/agent-script/src/loader/frontmatter.ts:30` accepts only `\n` and `\r\n`, causing a valid CR-only frontmatter opener to be classified as absent metadata.

## Expected Behavior

Markdown harness frontmatter using standalone `\r` line endings should be parsed the same way as equivalent LF or CRLF documents. The result should contain `{ title: "Example" }` as frontmatter and expose only the fenced script body for further processing.

## Impact

CR-only Markdown harness documents lose all configured metadata, including values supplied to harness runtime modules and lint behavior. The same document therefore runs with different inputs depending only on line-ending format, without an error explaining that its declared frontmatter was ignored.
