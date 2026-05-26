# OpenCode Poe auth build symlinked dist directory writes outside package

## Summary

The `opencode-poe-auth` package compiles its auth plugin into `dist` without rejecting symlinked output directories. A regular build writes the generated authentication plugin files into an external target when `dist` is linked there.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-opencode-poe-auth-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/opencode-poe-auth" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/opencode-poe-auth/src "$probe/packages/opencode-poe-auth/"
cp packages/opencode-poe-auth/package.json packages/opencode-poe-auth/tsconfig.json "$probe/packages/opencode-poe-auth/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/opencode-poe-auth/dist"
(cd "$probe/packages/opencode-poe-auth" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/opencode-poe-auth/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/poe-auth-plugin.js"
rm -rf "$probe"
```

The successful build emits:

```text
target=/private/tmp/poe-opencode-poe-auth-npm-build-probe.WzpkZ2/outside files=index.d.ts,index.js,poe-auth-plugin.d.ts,poe-auth-plugin.js
```

## Observed Behavior

The package `build` script invokes `tsc`, whose configured `dist` output root can be an external symlink target. No canonical output-directory check prevents external artifact writes.

## Expected Behavior

Compiled OpenCode authentication plugin artifacts should be written only beneath canonical `packages/opencode-poe-auth/dist` and builds should reject escapes.

## Impact

A routine authentication-plugin build can overwrite unrelated external files in a crafted workspace while reporting success.
