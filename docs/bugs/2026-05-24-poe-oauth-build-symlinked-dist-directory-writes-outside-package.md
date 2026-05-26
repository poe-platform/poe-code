# Poe OAuth build symlinked dist directory writes outside package

## Summary

The `poe-oauth` package emits authorization and client modules through TypeScript into a fixed `dist` directory. It performs no symlink-containment validation, so a linked output directory causes the ordinary package build to write generated OAuth artifacts outside the package boundary.

## Reproduction

From the repository root, execute a disposable build with an external output target:

```sh
probe=$(mktemp -d /tmp/poe-poe-oauth-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/poe-oauth" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/poe-oauth/src "$probe/packages/poe-oauth/"
cp packages/poe-oauth/package.json packages/poe-oauth/tsconfig.json "$probe/packages/poe-oauth/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/poe-oauth/dist"

(cd "$probe/packages/poe-oauth" && npm run build --silent)
printf 'dist_target=%s\n' "$(realpath "$probe/packages/poe-oauth/dist")"
printf 'files='
find "$probe/outside" -type f -exec basename {} \; | sort | head -8 | paste -sd, -

test -f "$probe/outside/index.js"
test -f "$probe/outside/oauth-client.js"
test -f "$probe/outside/loopback-authorization.js"
rm -rf "$probe"
```

The successful build emits OAuth implementation files into the external directory:

```text
dist_target=/private/tmp/poe-poe-oauth-npm-build-probe.WxeAX1/outside
files=authorization-state.d.ts,authorization-state.js,check-auth.d.ts,check-auth.js,index.d.ts,index.js,loopback-authorization.d.ts,loopback-authorization.js
```

## Observed Behavior

`packages/poe-oauth/package.json` invokes `tsc`, while the package TypeScript configuration emits beneath `dist`. The build writes through a `dist` symlink without checking its resolved destination, creating external OAuth package artifacts while returning success.

## Expected Behavior

The OAuth package build should modify only files inside its canonical output tree and reject output-directory symlinks that redirect emission elsewhere.

## Impact

A compromised working tree can turn a routine OAuth build into an unexpected external overwrite operation, which is especially problematic in automated release or validation environments that trust package build steps.
