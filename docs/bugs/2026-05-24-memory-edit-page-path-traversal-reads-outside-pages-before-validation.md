# Memory `editPage()` reads files outside `pages/` before validating the path

## Summary

The memory SDK's `editPage()` accepts a relative page path but joins it directly onto the memory root and reads the source content before delegating to `writePage()`, where page-path containment is enforced. Passing `../secret.md` therefore exposes a sibling file outside the memory root to the configured editor callback without triggering validation, as long as the editor leaves the content unchanged.

## Reproduction

From the repository root, use a disposable memory root with a sibling secret file and an editor callback that prints the temporary editing file:

```sh
repo=$PWD
probe=$(mktemp -d)
root="$probe/project/.poe-code/memory"
mkdir -p "$root/pages"
printf 'outside-memory-secret\n' > "$probe/project/.poe-code/secret.md"

cat > "$probe/repro.mts" <<EOF
import { readFile } from "node:fs/promises";
import { editPage } from "file://$PWD/packages/memory/src/edit.ts";

const result = await editPage("$root", "../secret.md", {
  reason: "inspect",
  launchEditor: async (filePath) => {
    console.log(await readFile(filePath, "utf8"));
  }
});
console.log(JSON.stringify(result));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/memory/src/edit.ts | sed -n '17,43p'
nl -ba packages/memory/src/write.ts | sed -n '88,97p'
```

## Observed Behavior

The operation succeeds and exposes the sibling file content through the editor callback:

```text
outside-memory-secret

{"changed":false}
```

`editPage()` reads `path.join(root, relPath)` and writes that content into a temporary editor file before any call to `writePage()`. Since the callback does not alter the copied content, the function returns `changed: false` and never reaches the write-path validator that would reject `../secret.md`.

## Expected Behavior

`editPage()` should validate that its target is a markdown page beneath `pages/` before reading any source content or invoking an editor callback. A traversal path such as `../secret.md` should be rejected without exposing outside files.

## Impact

SDK consumers that expose memory editing can be induced to read and reveal files adjacent to the memory directory under the guise of editing a page. This bypasses the page-only safety boundary enforced for actual writes and can disclose project configuration, notes, or other local markdown data.
