# Memory build symlinked dist directory writes outside package

## Summary

The `@poe-code/memory` build compiles memory commands and cache modules into `dist` without verifying its canonical output destination. When `dist` is symlinked outside the package, a normal successful build writes generated memory artifacts into that external location.

## Reproduction

The package imports its sibling `tokenfill` build output by relative path, so include that built dependency in a disposable package tree before running the build:

```sh
probe=$(mktemp -d /tmp/poe-memory-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/memory" "$probe/packages/tokenfill" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/memory/src "$probe/packages/memory/"
cp packages/memory/package.json packages/memory/tsconfig.json "$probe/packages/memory/"
cp -R packages/tokenfill/dist "$probe/packages/tokenfill/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/memory/dist"
(cd "$probe/packages/memory" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/memory/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -14 | paste -sd, -
test -f "$probe/outside/audit.js" && test -f "$probe/outside/cache.js"
rm -rf "$probe"
```

The successful reproduction prints:

```text
target=/private/tmp/poe-memory-npm-build-probe.hx4PLu/outside files=audit.d.ts,audit.js,cache.cli.d.ts,cache.cli.js,cache.d.ts,cache.js,confidence.d.ts,confidence.js,edit.d.ts,edit.js,explain.cli.d.ts,explain.cli.js,explain.d.ts,explain.js
```

## Observed Behavior

`packages/memory/package.json` invokes `tsc`, and its TypeScript configuration directs emitted files into `dist`. The build follows an output-directory symlink externally without checking package containment before creating modules.

## Expected Behavior

Memory build output should be confined to canonical `packages/memory/dist`, rejecting symlinked output roots outside that directory.

## Impact

A routine memory build can overwrite arbitrary external files with command and cache modules in a crafted checkout while returning success.
