# Tiny MCP client build symlinked dist directory writes outside package

## Summary

The `tiny-mcp-client` build emits its client implementation and compile-check modules into `dist` without preventing symlinked output redirection. A normal build succeeds while writing the artifacts into an external target.

## Reproduction

The package source imports its sibling `mcp-oauth` distribution by relative path, so retain that built dependency in a disposable tree:

```sh
probe=$(mktemp -d /tmp/poe-tiny-mcp-client-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/tiny-mcp-client" "$probe/packages/mcp-oauth" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/tiny-mcp-client/src "$probe/packages/tiny-mcp-client/"
cp packages/tiny-mcp-client/package.json packages/tiny-mcp-client/tsconfig.json "$probe/packages/tiny-mcp-client/"
cp -R packages/mcp-oauth/dist "$probe/packages/mcp-oauth/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/tiny-mcp-client/dist"
(cd "$probe/packages/tiny-mcp-client" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/tiny-mcp-client/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -14 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/internal.js"
rm -rf "$probe"
```

The build succeeds and emits:

```text
target=/private/tmp/poe-tiny-mcp-client-npm-build-probe.i0g00l/outside files=index.d.ts,index.js,internal.d.ts,internal.js,jsonrpc-types.compile-check.d.ts,jsonrpc-types.compile-check.js,mcp-lifecycle-types.compile-check.d.ts,mcp-lifecycle-types.compile-check.js,mcp-prompt-types.compile-check.d.ts,mcp-prompt-types.compile-check.js,mcp-resource-types.compile-check.d.ts,mcp-resource-types.compile-check.js,mcp-tool-types.compile-check.d.ts,mcp-tool-types.compile-check.js
```

## Observed Behavior

The package's TypeScript build emits to `dist` and follows an output symlink without validating that the real destination remains inside `tiny-mcp-client`.

## Expected Behavior

MCP client build artifacts should be emitted only beneath canonical `packages/tiny-mcp-client/dist`, with output-root symlink escapes rejected.

## Impact

Routine client-library builds can overwrite external files in a manipulated workspace while still reporting successful compilation.
