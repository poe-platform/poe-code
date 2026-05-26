# Tiny HTTP MCP OAuth test server build symlinked dist directory writes outside package

## Summary

The `tiny-http-mcp-oauth-test-server` package emits JavaScript and declaration files into its fixed `dist` directory during its normal TypeScript build. A symlinked `dist` directory redirects those outputs beyond the package boundary without causing the build to fail.

## Reproduction

From the repository root, create a disposable package tree containing its built local dependency and redirect its output directory before invoking the package build:

```sh
probe=$(mktemp -d /tmp/poe-tiny-http-mcp-oauth-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/tiny-http-mcp-oauth-test-server" "$probe/packages/mcp-oauth" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/tiny-http-mcp-oauth-test-server/src "$probe/packages/tiny-http-mcp-oauth-test-server/"
cp packages/tiny-http-mcp-oauth-test-server/package.json \
  packages/tiny-http-mcp-oauth-test-server/tsconfig.json \
  "$probe/packages/tiny-http-mcp-oauth-test-server/"
cp -R packages/mcp-oauth/dist "$probe/packages/mcp-oauth/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/tiny-http-mcp-oauth-test-server/dist"

(cd "$probe/packages/tiny-http-mcp-oauth-test-server" && npm run build --silent)
printf 'dist_target=%s\n' "$(realpath "$probe/packages/tiny-http-mcp-oauth-test-server/dist")"
printf 'artifacts='
find "$probe/outside" -type f -exec basename {} \; | sort | paste -sd, -

test -f "$probe/outside/index.js"
test -f "$probe/outside/cli.js"
test -f "$probe/outside/index.d.ts"
test -f "$probe/outside/cli.d.ts"
rm -rf "$probe"
```

The reproduction exits successfully and writes all emitted artifacts into the external target:

```text
dist_target=/private/tmp/poe-tiny-http-mcp-oauth-npm-build-probe.giDPrW/outside
artifacts=cli.d.ts,cli.js,index.d.ts,index.js
```

## Observed Behavior

`packages/tiny-http-mcp-oauth-test-server/package.json` defines `build` as `tsc`, and `packages/tiny-http-mcp-oauth-test-server/tsconfig.json:3` through `packages/tiny-http-mcp-oauth-test-server/tsconfig.json:8` emit into `dist`. The package does not validate the real output location before TypeScript follows a pre-existing `dist` symbolic link and writes outside the package.

## Expected Behavior

Building the package should modify files only below the canonical `packages/tiny-http-mcp-oauth-test-server/dist` output root. Symlink redirection outside that root should fail before any emitted artifact is written.

## Impact

A standard build in a compromised or malformed workspace can overwrite external files with OAuth test-server artifacts while returning success. This provides a write primitive outside the intended package directory in local and CI environments.
