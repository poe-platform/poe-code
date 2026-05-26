# Process launcher build symlinked dist directory writes outside package

## Summary

The `@poe-code/process-launcher` TypeScript build emits process-control and testing artifacts beneath a fixed `dist` directory without checking for symlink escapes. A linked output root redirects normal build writes outside the package.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-process-launcher-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/process-launcher" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/process-launcher/src "$probe/packages/process-launcher/"
cp packages/process-launcher/package.json packages/process-launcher/tsconfig.json "$probe/packages/process-launcher/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/process-launcher/dist"
(cd "$probe/packages/process-launcher" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/process-launcher/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -10 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/launcher.js"
rm -rf "$probe"
```

The build completes and writes through the symlinked destination:

```text
target=/private/tmp/poe-process-launcher-npm-build-probe.qbxiBJ/outside files=health-check.d.ts,health-check.js,index.d.ts,index.d.ts,index.js,index.js,launcher.d.ts,launcher.js,log-writer.d.ts,log-writer.js
```

## Observed Behavior

`packages/process-launcher/package.json:19` runs `tsc`, with `packages/process-launcher/tsconfig.json:4` targeting `dist`. No build guard rejects an output root that canonically resolves outside the package before emitted files are created there.

## Expected Behavior

The process-launcher build should emit only beneath its canonical package `dist` path, refusing escaped symbolic-link destinations.

## Impact

A normal process-launcher build can become an external overwrite operation against unrelated files when executed in a crafted checkout or with stale output symlinks.
