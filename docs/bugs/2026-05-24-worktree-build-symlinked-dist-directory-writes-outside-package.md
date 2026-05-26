# Worktree build symlinked dist directory writes outside package

## Summary

The `@poe-code/worktree` package build compiles worktree registry and lifecycle modules into `dist` without checking whether the destination resolves outside the package. A symlinked output directory turns the normal build into external file writes.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-worktree-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/worktree" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/worktree/src "$probe/packages/worktree/"
cp packages/worktree/package.json packages/worktree/tsconfig.json "$probe/packages/worktree/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/worktree/dist"
(cd "$probe/packages/worktree" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/worktree/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -10 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/registry.js"
rm -rf "$probe"
```

The successful build writes generated output through the external link:

```text
target=/private/tmp/poe-worktree-npm-build-probe.djwnVu/outside files=create.d.ts,create.js,index.d.ts,index.js,list.d.ts,list.js,registry.d.ts,registry.js,remove.d.ts,remove.js
```

## Observed Behavior

`packages/worktree/package.json:15` runs `tsc`, and `packages/worktree/tsconfig.json:4` sets `dist` as the emission directory. The build follows a symlinked `dist` without verifying that the canonical output root remains under the package.

## Expected Behavior

Generated worktree modules should be emitted only beneath canonical `packages/worktree/dist`, with escaped output symlinks rejected before emission.

## Impact

A routine build of the worktree package can overwrite files outside the package in a manipulated checkout while appearing to complete successfully.
