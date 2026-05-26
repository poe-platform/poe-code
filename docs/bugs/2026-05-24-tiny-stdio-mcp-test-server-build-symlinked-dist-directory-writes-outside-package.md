# Tiny stdio MCP test server build symlinked dist directory writes outside package

## Summary

The `tiny-stdio-mcp-test-server` package emits its CLI and server modules into `dist` without checking whether that output root is a symbolic link outside the package. A standard build writes externally through such a link.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-tiny-stdio-mcp-test-server-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/tiny-stdio-mcp-test-server" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/tiny-stdio-mcp-test-server/src "$probe/packages/tiny-stdio-mcp-test-server/"
cp packages/tiny-stdio-mcp-test-server/package.json packages/tiny-stdio-mcp-test-server/tsconfig.json "$probe/packages/tiny-stdio-mcp-test-server/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/tiny-stdio-mcp-test-server/dist"
(cd "$probe/packages/tiny-stdio-mcp-test-server" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/tiny-stdio-mcp-test-server/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/cli.js"
rm -rf "$probe"
```

The successful output is:

```text
target=/private/tmp/poe-tiny-stdio-mcp-test-server-npm-build-probe.Rgsgbo/outside files=cli.d.ts,cli.js,index.d.ts,index.js
```

## Observed Behavior

The package build runs `tsc` against a `dist` output directory and follows an externally targeted symlink without checking its canonical location before creating files.

## Expected Behavior

Build artifacts should be confined to canonical `packages/tiny-stdio-mcp-test-server/dist`, rejecting output links that escape the package boundary.

## Impact

A normal test MCP server build can overwrite unexpected external files in a crafted or stale-symlink working tree while reporting successful compilation.
