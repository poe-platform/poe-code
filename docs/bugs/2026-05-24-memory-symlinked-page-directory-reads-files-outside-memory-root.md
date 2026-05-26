# Memory page discovery follows symlinked directories outside the memory root

## Summary

The memory page enumerator recursively walks `pages/` using `fs.stat()` and follows directory symlinks without checking their canonical targets. If `pages/linked` is a symlink to an external directory, `poe-code memory ls` and `poe-code memory search` treat markdown files in that outside directory as normal memory pages and disclose their content.

## Reproduction

From the repository root, create an initialized disposable memory fixture whose `pages/` directory contains a symlink to an external folder:

```sh
repo=$PWD
probe=$(mktemp -d)
project="$probe/project"
home="$probe/home"
outside="$probe/outside"
mkdir -p "$project/.poe-code/memory/pages" "$home" "$outside"

printf '# Memory index\n' > "$project/.poe-code/memory/INDEX.md"
printf '' > "$project/.poe-code/memory/LOG.md"
cat > "$outside/secret.md" <<'EOF'
---
description: linked secret
---
# Outside
symlink-secret-line
EOF
ln -s "$outside" "$project/.poe-code/memory/pages/linked"

(
  cd "$project" || exit 1
  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" memory ls

  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" memory search symlink-secret-line
)

nl -ba packages/memory/src/pages.ts | sed -n '54,102p'
```

## Observed Behavior

The external markdown file is listed and its contents are searchable as if it lived below memory `pages/`:

```text
linked/secret.md — linked secret
linked/secret.md:5: symlink-secret-line
```

`collectMarkdownRelPathsInto()` calls `fs.stat(entryAbsPath)`, which resolves symlink targets. When the target is a directory, the function recursively reads through the symlink and records relative paths below `pages/linked` without verifying that their canonical locations remain within the memory root.

## Expected Behavior

Memory page discovery should not traverse directory symlinks outside `<memory root>/pages/`, or should reject any entry whose canonical path is outside the allowed directory. Outside files must not be listed or searched as memory pages.

## Impact

A repository containing a crafted symlink under its memory pages directory can cause normal read-only memory commands to disclose arbitrary external markdown files accessible to the user running `poe-code`. This breaks the package's repo-scoped memory boundary and can expose local notes or configuration content.
