# Markdown reader padded numeric section selector is rejected

## Summary

`@poe-code/markdown-reader` documents `read-section` selectors as accepting either a numeric path or an exact heading title, and it tolerates surrounding whitespace for title selectors. However, the equivalent numeric selector fails when it contains leading or trailing whitespace. A user can read `" Child "` successfully but receives a not-found error for `" 1 "`, even though both identify the same listed section.

## Reproduction

Create a disposable Vitest probe at `packages/markdown-reader/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { createReadSection } from "./core/read-section.js";

type ReadOnlyFs = {
  readFile(path: string, encoding?: BufferEncoding): Promise<string>;
};

function createMemFs(files: Record<string, string>): ReadOnlyFs {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as ReadOnlyFs;
}

describe("markdown-reader numeric section selector whitespace", () => {
  it("accepts a padded numeric selector just like a padded title selector", async () => {
    const readSection = createReadSection({
      fs: createMemFs({ "/repo/docs/test.md": "# Title\n\n## Child\n\nBody.\n" }),
      cwd: "/repo"
    });

    await expect(readSection({ file: "docs/test.md", section: " Child " })).resolves.toMatchObject({
      section: { number: "1", title: "Child" }
    });
    await expect(readSection({ file: "docs/test.md", section: " 1 " })).resolves.toMatchObject({
      section: { number: "1", title: "Child" }
    });
  });
});
```

Run and remove the probe:

```sh
npm exec -- vitest run packages/markdown-reader/src/__probe__.test.ts --reporter verbose
rm -f packages/markdown-reader/src/__probe__.test.ts
```

## Observed Behavior

The padded title selector succeeds, but the same test fails when it attempts to resolve the padded numeric selector:

```text
FAIL  packages/markdown-reader/src/__probe__.test.ts > markdown-reader numeric section selector whitespace > accepts a padded numeric selector just like a padded title selector
AssertionError: promise rejected "UserError: no section matching \" 1 \" (try…" instead of resolving

Caused by: UserError: no section matching " 1 " (try 'read-markdown' to see the table of contents)
 ❯ resolveSection packages/markdown-reader/src/core/resolve.ts:22:9
 ❯ readSection packages/markdown-reader/src/core/read-section.ts:21:21
```

`resolveSection()` tries an exact numeric match before it computes `trimmedId`: `sections.find((section) => section.number === id)` at `packages/markdown-reader/src/core/resolve.ts:5` uses the untrimmed value, while its title match at `packages/markdown-reader/src/core/resolve.ts:11` through `:12` uses `id.trim()`.

## Expected Behavior

`read-section` should normalize a selector consistently before resolving either documented selector form, so a padded numeric path such as `" 1 "` identifies the same section as `"1"`, just as a padded title already identifies the same section as its trimmed title.

## Impact

Callers passing human-entered or formatted selector text can successfully use padded title values but unexpectedly fail after switching to the unambiguous numeric path recommended by the API's own duplicate-title error message. This makes the reliable numeric selection path brittle in interactive clients and agent-generated requests.
