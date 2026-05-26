# Tiny stdio MCP server build symlinked dist directory writes outside package

## Summary

The `tiny-stdio-mcp-server` package compiles its protocol server and content helpers into `dist` without preventing output-directory symlink escape. A normal build can populate an external target with generated MCP server artifacts.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-tiny-stdio-mcp-server-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/tiny-stdio-mcp-server" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/tiny-stdio-mcp-server/src "$probe/packages/tiny-stdio-mcp-server/"
cp packages/tiny-stdio-mcp-server/package.json packages/tiny-stdio-mcp-server/tsconfig.json "$probe/packages/tiny-stdio-mcp-server/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/tiny-stdio-mcp-server/dist"
(cd "$probe/packages/tiny-stdio-mcp-server" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/tiny-stdio-mcp-server/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -12 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/server.js"
rm -rf "$probe"
```

The build succeeds and external output begins with:

```text
target=/private/tmp/poe-tiny-stdio-mcp-server-npm-build-probe.7BMeuD/outside files=audio.d.ts,audio.js,convert.d.ts,convert.js,file-type.d.ts,file-type.js,file.d.ts,file.js,image.d.ts,image.js,index.d.ts,index.d.ts
```

## Observed Behavior

The MCP server package builds using TypeScript into `dist`, following an external output symlink without verifying package containment before emission.

## Expected Behavior

Generated stdio-MCP server files should remain under canonical `packages/tiny-stdio-mcp-server/dist`, and builds should reject escaping symlinks.

## Impact

An ordinary MCP server build can overwrite external files with generated protocol/helper modules under build-runner privileges while returning success.
