# File lock build symlinked dist directory writes outside package

## Summary

The `@poe-code/file-lock` package emits JavaScript and declaration files into its fixed `dist` directory through `tsc` without validating that the output root is still within the package. A symlinked `dist` directory redirects the standard build output into an external location.

## Reproduction

From the repository root, run a disposable package build whose output directory points outside its package tree:

```sh
probe=$(mktemp -d /tmp/poe-file-lock-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/file-lock" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/file-lock/src "$probe/packages/file-lock/"
cp packages/file-lock/package.json packages/file-lock/tsconfig.json "$probe/packages/file-lock/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/file-lock/dist"

(cd "$probe/packages/file-lock" && npm run build --silent)
printf 'dist_target=%s\n' "$(realpath "$probe/packages/file-lock/dist")"
printf 'files='
find "$probe/outside" -type f -exec basename {} \; | sort | paste -sd, -

test -f "$probe/outside/index.js"
test -f "$probe/outside/lock.js"
test -f "$probe/outside/index.d.ts"
rm -rf "$probe"
```

The reproduction succeeds and writes the package artifacts outside its directory:

```text
dist_target=/private/tmp/poe-file-lock-npm-build-probe.LuPX0u/outside
files=index.d.ts,index.js,lock.d.ts,lock.js
```

## Observed Behavior

`packages/file-lock/package.json` defines `build` as `tsc`, and `packages/file-lock/tsconfig.json` selects `dist` as the emission directory. The normal build follows an existing `dist` symlink and creates the emitted files in its external target without rejecting the escaped output path.

## Expected Behavior

Building `@poe-code/file-lock` should emit only inside the canonical package `dist` directory and should reject a symlinked output root before it can write outside that boundary.

## Impact

A manipulated checkout or stale output symlink can turn a routine local or CI build into an external file overwrite with build-process privileges while the command reports success.
