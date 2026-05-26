# Memory show path traversal reads files outside pages directory

## Summary

The `poe-code memory show <path>` command accepts traversal segments in the requested page path. Supplying `../secret` causes it to read and display `.poe-code/memory/secret.md`, outside the intended `.poe-code/memory/pages/` page directory.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: source CLI entrypoint with a disposable `HOME`, disposable project directory, and manually initialized memory fixture files

## Reproduction

From the repository root, create an initialized disposable memory directory and a Markdown file outside `pages/`, then request it via a traversal path:

```sh
repo=$PWD
probe=$(mktemp -d)
home="$probe/home"
project="$probe/project"
mkdir -p "$home" "$project/.poe-code/memory/pages"
printf '# Index\n' > "$project/.poe-code/memory/INDEX.md"
printf '# Log\n' > "$project/.poe-code/memory/LOG.md"
printf 'outside-page-secret\n' > "$project/.poe-code/memory/secret.md"

(
  cd "$project" &&
  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" memory show ../secret
)
```

## Observed Behavior

The command exits successfully and prints the content of a Markdown file outside the page directory:

```text
┌   Poe - memory show
outside-page-secret
```

The file read is `.poe-code/memory/secret.md`, not `.poe-code/memory/pages/secret.md`.

## Expected Behavior

`memory show` should only read page files contained within `.poe-code/memory/pages/`. A path containing traversal components such as `../secret` should be rejected as invalid rather than escaping the page directory.

## Impact

- The command can disclose Markdown content outside the memory pages namespace, including index/log-adjacent or other project memory artifacts.
- Consumers cannot rely on the documented page-relative input boundary to restrict reads to user-authored pages.
- Scripts accepting a page path from untrusted input can unintentionally expose files reachable within the memory root.

## Supporting Evidence

In `src/cli/commands/memory.ts`, `resolvePageRelPath()` prefixes non-`pages/` inputs with `pages/` but does not reject `..` components. The `show` command then constructs `path.join(mem.root, relPath)`. For input `../secret`, the generated relative string is `pages/../secret.md`, and Node path resolution collapses it to `<memory-root>/secret.md`, outside `<memory-root>/pages/`.

## Suspected Area

Memory page resolution should normalize and validate page-relative paths, reject traversal and absolute-path escapes, and confirm the resolved file remains beneath the canonical `pages/` directory before reading it.
