# Pipeline build symlinked dist directory writes outside package

## Summary

The `@poe-code/pipeline` TypeScript build writes discovery, parsing, and lock modules into `dist` without validating that its output root remains within the package. An external symlink target receives normal build output.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-pipeline-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/pipeline" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/pipeline/src "$probe/packages/pipeline/"
cp packages/pipeline/package.json packages/pipeline/tsconfig.json "$probe/packages/pipeline/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/pipeline/dist"
(cd "$probe/packages/pipeline" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/pipeline/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -12 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/parser.js"
rm -rf "$probe"
```

The successful output is:

```text
target=/private/tmp/poe-pipeline-npm-build-probe.byjMaZ/outside files=discovery.d.ts,discovery.js,index.d.ts,index.js,interpolate.d.ts,interpolate.js,loader.d.ts,loader.js,lock.d.ts,lock.js,parser.d.ts,parser.js
```

## Observed Behavior

`packages/pipeline/package.json:19` runs `tsc` and `packages/pipeline/tsconfig.json:4` declares `dist` as its output path. Build emission follows a pre-existing external symlink unconditionally.

## Expected Behavior

Pipeline build artifacts should be emitted only beneath canonical `packages/pipeline/dist`, with symlink output escapes rejected.

## Impact

A normal pipeline build in a modified workspace can overwrite external files with generated runtime modules while returning success.
