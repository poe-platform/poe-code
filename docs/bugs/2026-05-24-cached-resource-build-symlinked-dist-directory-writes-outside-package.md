# Cached resource build symlinked dist directory writes outside package

## Summary

The `@poe-code/cached-resource` build compiles cache and revalidation modules into its `dist` directory without guarding against symbolic-link output roots. A symlinked `dist` redirects package artifacts outside the intended directory.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-cached-resource-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/cached-resource" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/cached-resource/src "$probe/packages/cached-resource/"
cp packages/cached-resource/package.json packages/cached-resource/tsconfig.json "$probe/packages/cached-resource/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/cached-resource/dist"
(cd "$probe/packages/cached-resource" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/cached-resource/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -10 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/disk-cache.js"
rm -rf "$probe"
```

The reproduction emits external files successfully:

```text
target=/private/tmp/poe-cached-resource-npm-build-probe.pnGTc8/outside files=api-fetch.d.ts,api-fetch.js,background-revalidator.d.ts,background-revalidator.js,cache-orchestrator.d.ts,cache-orchestrator.js,create-cached-resource.d.ts,create-cached-resource.js,disk-cache.d.ts,disk-cache.js
```

## Observed Behavior

`packages/cached-resource/package.json:19` runs `tsc`, while `packages/cached-resource/tsconfig.json:4` declares `dist` as the output root. Compilation follows a symlinked `dist` without verifying its canonical package containment.

## Expected Behavior

The build should fail before writing if the output directory resolves outside the package's canonical `dist` tree.

## Impact

Local and automated cache-package builds can overwrite unexpected external files when run from an untrusted or accidentally corrupted working tree.
