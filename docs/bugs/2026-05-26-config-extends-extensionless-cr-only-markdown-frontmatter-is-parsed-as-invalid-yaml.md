# Config extends extensionless CR-only Markdown frontmatter is parsed as invalid YAML

## Summary

The exported `@poe-code/config-extends` `parseDocument()` API identifies extensionless Markdown content by looking for a frontmatter opening fence followed by LF or CRLF only. An otherwise valid extensionless Markdown document using carriage-return-only (`\r`) line endings is misclassified as YAML and throws a YAML parsing error instead of exposing its frontmatter and prompt body.

## Reproduction

Create the following disposable probe at `packages/config-extends/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseDocument } from "./parse.js";

describe("CR-only markdown frontmatter detection", () => {
  it("rejects extensionless markdown frontmatter written with CR line endings as YAML", () => {
    const content = "---\rextends: true\rtitle: Child\r---\rPrompt body\r";

    expect(() => parseDocument(content, "/work/child")).toThrow(
      "Block collection cannot start on same line with directives-end marker"
    );
  });
});
```

Run the probe and remove it immediately afterward:

```sh
npm exec -- vitest run packages/config-extends/src/__probe__.test.ts --reporter verbose
rm packages/config-extends/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/config-extends/src/__probe__.test.ts > CR-only markdown frontmatter detection > rejects extensionless markdown frontmatter written with CR line endings as YAML
```

## Observed Behavior

Calling `parseDocument()` with the extensionless document `"---\rextends: true\rtitle: Child\r---\rPrompt body\r"` throws a YAML parser error beginning `Block collection cannot start on same line with directives-end marker`. `parseDocument()` chooses its parser through `detectFormat()` at `packages/config-extends/src/parse.ts:6`. For files without `.md`, `.yaml`, `.yml`, or `.json` suffixes, that detector recognizes Markdown frontmatter only when the input begins with `"---\n"` or `"---\r\n"` at `packages/config-extends/src/parse.ts:48`; a standalone-CR opener falls through to `"yaml"` at `packages/config-extends/src/parse.ts:52` and is then parsed through `parseYaml()` at `packages/config-extends/src/parse.ts:12`.

## Expected Behavior

Extensionless Markdown documents with valid frontmatter should be detected consistently across ordinary line-ending styles, including CR-only input, or unsupported line endings should be rejected with a format-specific diagnostic. A Markdown frontmatter document must not be routed into the YAML-document parser solely because its line endings differ.

## Impact

Base-resolved prompts or configuration documents supplied without filename extensions can fail to load when authored or generated with CR-only line endings. Their declared `extends` behavior, prompt body, and configuration fields become unavailable behind an unrelated YAML syntax failure, causing inheritance and workflow startup to break based only on text newline encoding.
