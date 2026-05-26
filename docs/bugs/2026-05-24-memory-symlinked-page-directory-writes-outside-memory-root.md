# Memory page write APIs follow symlinked directories outside the memory root

## Summary

`writePage()` and `appendToPage()` validate that a relative path textually begins with `pages/`, but they do not verify the canonical destination after filesystem symlinks are resolved. If `pages/linked` is a symlink to an external directory, both APIs accept `pages/linked/new.md` and write content outside the memory root.

## Reproduction

From the repository root, create an initialized disposable memory fixture with a symlinked page subdirectory and invoke the public write APIs:

```sh
repo=$PWD
probe=$(mktemp -d)
root="$probe/project/.poe-code/memory"
outside="$probe/outside"
mkdir -p "$root/pages" "$outside"
printf '# Memory index\n' > "$root/INDEX.md"
printf '' > "$root/LOG.md"
ln -s "$outside" "$root/pages/linked"

cat > "$probe/repro.mts" <<EOF
import { writePage, appendToPage } from "file://$PWD/packages/memory/src/write.ts";

await writePage("$root", "pages/linked/new.md", "# New outside\n", { reason: "write" });
await appendToPage("$root", "pages/linked/new.md", "appended-outside\n", { reason: "append" });
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
cat "$outside/new.md"

nl -ba packages/memory/src/write.ts | sed -n '10,51p;88,98p'
```

## Observed Behavior

Both accepted API calls write to the external symlink target, producing an outside file containing the page body and appended data:

```text
---
last_touched_at: ...
---
# New outside
appended-outside
```

The path validator accepts `pages/linked/new.md` because it is a relative markdown path with a `pages/` prefix. Subsequent `fs.writeFile(path.join(root, pageRelPath), ...)` follows the existing `pages/linked` symlink outside the memory root.

## Expected Behavior

Memory page mutations should remain beneath the canonical `<memory root>/pages/` directory even when symlinks are present. A destination whose resolved parent escapes that directory should be rejected before any write occurs.

## Impact

Projects containing a crafted symlink in memory pages can redirect SDK page writes and appends to arbitrary external locations accessible to the caller. This violates the page-only write boundary and can overwrite user files outside repository memory storage.
