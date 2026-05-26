# Tiny OAuth test server build symlinked dist directory writes outside package

## Summary

The `tiny-oauth-test-server` build emits its server and CLI artifacts under a fixed `dist` directory without verifying the output path remains in the package. A symlink at `dist` redirects successful build writes externally.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-tiny-oauth-test-server-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/tiny-oauth-test-server" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/tiny-oauth-test-server/src "$probe/packages/tiny-oauth-test-server/"
cp packages/tiny-oauth-test-server/package.json packages/tiny-oauth-test-server/tsconfig.json "$probe/packages/tiny-oauth-test-server/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/tiny-oauth-test-server/dist"
(cd "$probe/packages/tiny-oauth-test-server" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/tiny-oauth-test-server/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/cli.js"
rm -rf "$probe"
```

The reproduction succeeds:

```text
target=/private/tmp/poe-tiny-oauth-test-server-npm-build-probe.VKEkRZ/outside files=cli.d.ts,cli.js,index.d.ts,index.js
```

## Observed Behavior

The package build uses `tsc` with `dist` as its output directory, and does not validate that a symlinked destination remains under `tiny-oauth-test-server` before emitting server artifacts externally.

## Expected Behavior

The test-server build should write generated output only beneath canonical `packages/tiny-oauth-test-server/dist`, rejecting linked external destinations.

## Impact

Local and CI test-server builds can unexpectedly overwrite external files when run in a malicious or corrupted working directory.
