# Config extends build symlinked dist directory writes outside package

## Summary

The `@poe-code/config-extends` package uses a fixed `dist` TypeScript output directory without canonical-containment checks. A symlink at that directory redirects a normal package build to populate an arbitrary external directory with generated modules and declarations.

## Reproduction

From the repository root, build a disposable package copy with a redirected `dist` directory:

```sh
probe=$(mktemp -d /tmp/poe-config-extends-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/config-extends" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/config-extends/src "$probe/packages/config-extends/"
cp packages/config-extends/package.json packages/config-extends/tsconfig.json "$probe/packages/config-extends/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/config-extends/dist"

(cd "$probe/packages/config-extends" && npm run build --silent)
printf 'dist_target=%s\n' "$(realpath "$probe/packages/config-extends/dist")"
printf 'files='
find "$probe/outside" -type f -exec basename {} \; | sort | head -8 | paste -sd, -

test -f "$probe/outside/index.js"
test -f "$probe/outside/discover.js"
test -f "$probe/outside/merge.js"
rm -rf "$probe"
```

The reproduction completes successfully with output in the external target:

```text
dist_target=/private/tmp/poe-config-extends-npm-build-probe.m9loTH/outside
files=discover.d.ts,discover.js,index.d.ts,index.js,merge.d.ts,merge.js,parse.d.ts,parse.js
```

## Observed Behavior

`packages/config-extends/package.json` invokes `tsc` for builds and `packages/config-extends/tsconfig.json` emits into `dist`. No build validation rejects the symbolic-link output root before compilation creates all of these artifacts at the linked external path.

## Expected Behavior

The package build should write generated configuration-extension modules only below its canonical `dist` directory, rejecting any symlink redirect that escapes the package.

## Impact

Normal development or publishing builds can overwrite external files when run in a crafted workspace, even though the build itself appears successful and is expected to modify only package output.
