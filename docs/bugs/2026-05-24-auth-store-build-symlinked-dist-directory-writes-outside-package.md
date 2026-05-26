# Auth store build symlinked dist directory writes outside package

## Summary

The `@poe-code/auth-store` build emits credential-store modules into `dist` without checking whether the output directory is a symlink. A linked `dist` causes the successful build to write generated output to an external location.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-auth-store-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/auth-store" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/auth-store/src "$probe/packages/auth-store/"
cp packages/auth-store/package.json packages/auth-store/tsconfig.json "$probe/packages/auth-store/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/auth-store/dist"
(cd "$probe/packages/auth-store" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/auth-store/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -10 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/encrypted-file-store.js"
rm -rf "$probe"
```

The build succeeds and prints:

```text
target=/private/tmp/poe-auth-store-npm-build-probe.P5mDFb/outside files=create-secret-store.d.ts,create-secret-store.js,encrypted-file-store.d.ts,encrypted-file-store.js,index.d.ts,index.js,keychain-store.d.ts,keychain-store.js,provider-store.d.ts,provider-store.js
```

## Observed Behavior

`packages/auth-store/package.json:14` invokes `tsc`, and `packages/auth-store/tsconfig.json:4` configures output into `dist`. The output directory can resolve outside the package through a symlink without stopping emitted writes.

## Expected Behavior

Build output should stay beneath canonical `packages/auth-store/dist`; an escaped symbolic-link output root should be rejected before emission.

## Impact

A routine authentication-store build can be redirected into external file overwrites in a compromised workspace while still exiting successfully.
