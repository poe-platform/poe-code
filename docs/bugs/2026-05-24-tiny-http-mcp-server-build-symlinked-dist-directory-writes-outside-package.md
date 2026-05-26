# Tiny HTTP MCP server build symlinked dist directory writes outside package

## Summary

The `tiny-http-mcp-server` package compiles HTTP transport, authentication, and CLI artifacts into `dist` without symlink-output validation. Linking `dist` to an external directory causes a normal build to write those files outside the package.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-tiny-http-mcp-server-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/tiny-http-mcp-server" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/tiny-http-mcp-server/src "$probe/packages/tiny-http-mcp-server/"
cp packages/tiny-http-mcp-server/package.json packages/tiny-http-mcp-server/tsconfig.json "$probe/packages/tiny-http-mcp-server/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/tiny-http-mcp-server/dist"
(cd "$probe/packages/tiny-http-mcp-server" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/tiny-http-mcp-server/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -12 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/http-server.js"
rm -rf "$probe"
```

The package build completes successfully:

```text
target=/private/tmp/poe-tiny-http-mcp-server-npm-build-probe.HBz0jz/outside files=auth.d.ts,auth.js,cli.d.ts,cli.js,express-middleware.d.ts,express-middleware.js,http-server.d.ts,http-server.js,http-transport.d.ts,http-transport.js,index.d.ts,index.js
```

## Observed Behavior

The package runs `tsc` with `dist` as its output root and does not check the canonical target before following an external symbolic link for artifact emission.

## Expected Behavior

Generated HTTP MCP server artifacts should remain under canonical `packages/tiny-http-mcp-server/dist`, with symlink escapes rejected before writes.

## Impact

Normal builds can unexpectedly overwrite external files with server and transport modules in modified working directories while returning success.
