# Terminal PNG MCP build symlinked dist directory writes outside package

## Summary

The `terminal-png-mcp` package compiles JavaScript and declaration artifacts into its fixed `dist` output directory without rejecting symbolic links. If `packages/terminal-png-mcp/dist` points outside the package, running the normal TypeScript build creates or overwrites emitted package artifacts in the external target directory.

## Reproduction

From the repository root, create a disposable copy of the package whose `dist` directory is a symbolic link to an external directory, then run its configured TypeScript build:

```sh
probe=$(mktemp -d /tmp/poe-terminal-png-mcp-build-probe.XXXXXX)
mkdir -p "$probe/packages/terminal-png-mcp/src" "$probe/outside"
cp tsconfig.json "$probe/"
cp packages/terminal-png-mcp/package.json packages/terminal-png-mcp/tsconfig.json \
  "$probe/packages/terminal-png-mcp/"
cp packages/terminal-png-mcp/src/*.ts "$probe/packages/terminal-png-mcp/src/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/terminal-png-mcp/dist"

"$PWD/node_modules/.bin/tsc" -p "$probe/packages/terminal-png-mcp/tsconfig.json"
printf 'dist_target=%s\n' "$(realpath "$probe/packages/terminal-png-mcp/dist")"
printf 'outside_files='
find "$probe/outside" -maxdepth 1 -type f -exec basename {} \; | sort | paste -sd, -

test -f "$probe/outside/index.js"
test -f "$probe/outside/cli.js"
test -f "$probe/outside/index.d.ts"
test -f "$probe/outside/cli.d.ts"
rm -rf "$probe"
```

The reproduction completes successfully and prints an external output target containing all build artifacts:

```text
dist_target=/private/tmp/poe-terminal-png-mcp-build-probe.43Ojmc/outside
outside_files=cli.d.ts,cli.js,index.d.ts,index.js
```

## Observed Behavior

`packages/terminal-png-mcp/package.json` defines its package build as `tsc`, and `packages/terminal-png-mcp/tsconfig.json:3` through `packages/terminal-png-mcp/tsconfig.json:8` configure emission into `dist`. No build step checks whether that output directory canonically remains inside the package before TypeScript writes the generated `.js` and `.d.ts` files through a pre-existing symbolic link.

## Expected Behavior

Running the package build should emit artifacts only beneath the canonical `packages/terminal-png-mcp/dist` directory. A symlinked output directory that redirects writes outside the package should be rejected before files are generated or overwritten.

## Impact

A crafted checkout, compromised workspace, or stale symlink can redirect a routine local or CI package build to overwrite files outside `terminal-png-mcp` with the build process's privileges. The build reports success while mutating an unexpected external location.
