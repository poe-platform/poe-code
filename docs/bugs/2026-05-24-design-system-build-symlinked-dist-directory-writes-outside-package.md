# Design system build symlinked dist directory writes outside package

## Summary

The `@poe-code/design-system` build emits its compiled module tree into a fixed `dist` directory without rejecting symlinks. If that directory is linked outside the package, the documented build operation writes the complete generated design-system artifact set into the external destination.

## Reproduction

From the repository root, run the package build in a disposable copy with a symlinked output directory:

```sh
probe=$(mktemp -d /tmp/poe-design-system-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/design-system" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/design-system/src packages/design-system/scripts packages/design-system/layouts \
  "$probe/packages/design-system/"
cp packages/design-system/package.json packages/design-system/tsconfig.json \
  "$probe/packages/design-system/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/design-system/dist"

(cd "$probe/packages/design-system" && npm run build --silent)
printf 'dist_target=%s\n' "$(realpath "$probe/packages/design-system/dist")"
printf 'artifacts='
find "$probe/outside" -type f -exec basename {} \; | sort | head -8 | paste -sd, -

test -f "$probe/outside/index.js"
test -f "$probe/outside/index.d.ts"
rm -rf "$probe"
```

The reproduction completes successfully and emits generated files outside the package:

```text
dist_target=/private/tmp/poe-design-system-npm-build-probe.dQlv9n/outside
artifacts=actions.d.ts,actions.js,ansi.d.ts,ansi.js,ast.d.ts,ast.js,block.d.ts,block.js
```

## Observed Behavior

`packages/design-system/package.json` runs `tsc` as its build command, and `packages/design-system/tsconfig.json:3` through `packages/design-system/tsconfig.json:8` target `dist` for emitted output. Neither the TypeScript compilation step nor the subsequent package build path verifies canonical containment of that directory before writing through a symbolic link.

## Expected Behavior

Build artifacts should be emitted only below the canonical `packages/design-system/dist` tree. The build should reject a symlinked output root escaping the package rather than populate an arbitrary external directory.

## Impact

A manipulated checkout or stale output-directory link can cause the standard design-system build to overwrite files outside its package. This affects a broad artifact tree and can occur during normal local or automated builds without an error signal.
