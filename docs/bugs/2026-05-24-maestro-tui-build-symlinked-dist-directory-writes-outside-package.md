# Maestro TUI build symlinked dist directory writes outside package

## Summary

The `@poe-code/maestro-tui` package compiles build artifacts into its fixed `dist` directory without verifying that the output path remains within the package. A symbolic link at `packages/maestro-tui/dist` redirects a normal `npm run build` to write generated JavaScript and declaration files into an external directory.

## Reproduction

From the repository root, run a disposable package copy whose build output directory points outside the package:

```sh
probe=$(mktemp -d /tmp/poe-maestro-tui-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/maestro-tui" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/maestro-tui/src "$probe/packages/maestro-tui/"
cp packages/maestro-tui/package.json packages/maestro-tui/tsconfig.json \
  "$probe/packages/maestro-tui/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/maestro-tui/dist"

(cd "$probe/packages/maestro-tui" && npm run build --silent)
printf 'dist_target=%s\n' "$(realpath "$probe/packages/maestro-tui/dist")"
printf 'artifacts='
find "$probe/outside" -type f -exec basename {} \; | sort | paste -sd, -

test -f "$probe/outside/index.js"
test -f "$probe/outside/run.js"
test -f "$probe/outside/index.d.ts"
rm -rf "$probe"
```

The reproduction exits successfully and prints externally written build output:

```text
dist_target=/private/tmp/poe-maestro-tui-npm-build-probe.BFqhkN/outside
artifacts=actions.d.ts,actions.js,explorer-config.d.ts,explorer-config.js,index.d.ts,index.js,run.d.ts,run.js
```

## Observed Behavior

`packages/maestro-tui/package.json` defines `build` as `tsc`, while `packages/maestro-tui/tsconfig.json:3` through `packages/maestro-tui/tsconfig.json:8` emit directly beneath `dist`. The build does not inspect or reject a symlinked `dist` directory before TypeScript writes all compiled output through that link into the external target.

## Expected Behavior

The package build should create or modify artifacts only under the canonical `packages/maestro-tui/dist` directory. A `dist` link escaping the package must be rejected before emitting files.

## Impact

A routine development, CI, or publishing build in a crafted workspace can overwrite external files with the build runner's privileges while still reporting success, allowing output-path redirection outside the intended package boundary.
