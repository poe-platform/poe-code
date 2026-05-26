# Providers build symlinked dist directory writes outside package

## Summary

The `@poe-code/providers` package compiles provider modules into `dist` without verifying the resolved output directory. A symbolic link at `dist` causes its regular build to place generated provider code and declarations outside the package.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-providers-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/providers" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/providers/src "$probe/packages/providers/"
cp packages/providers/package.json packages/providers/tsconfig.json "$probe/packages/providers/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/providers/dist"
(cd "$probe/packages/providers" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/providers/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -10 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/anthropic.js"
rm -rf "$probe"
```

The reproduction succeeds and writes external generated provider modules:

```text
target=/private/tmp/poe-providers-npm-build-probe.bN4nBO/outside files=anthropic.d.ts,anthropic.js,api-key.d.ts,api-key.js,cloudflare.d.ts,cloudflare.js,compatibility.d.ts,compatibility.js,index.d.ts,index.js
```

## Observed Behavior

`packages/providers/package.json:15` declares `tsc` as the build command, and `packages/providers/tsconfig.json:4` sends output to `dist`. A symlinked output root is followed without a canonical-containment check.

## Expected Behavior

Provider builds should modify files only under canonical `packages/providers/dist` and reject output roots that escape that directory.

## Impact

A routine provider package build can overwrite arbitrary external files in a manipulated workspace while reporting a successful compile.
