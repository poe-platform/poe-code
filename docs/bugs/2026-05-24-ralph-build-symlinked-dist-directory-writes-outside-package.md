# Ralph build symlinked dist directory writes outside package

## Summary

The `@poe-code/ralph` TypeScript build emits workflow discovery and simulation modules into `dist` without output-root symlink validation. Redirecting `dist` externally causes successful build writes outside the package.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-ralph-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/ralph" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/ralph/src "$probe/packages/ralph/"
cp packages/ralph/package.json packages/ralph/tsconfig.json "$probe/packages/ralph/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/ralph/dist"
(cd "$probe/packages/ralph" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/ralph/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -14 | paste -sd, -
test -f "$probe/outside/ralph.js" && test -f "$probe/outside/simulation.js"
rm -rf "$probe"
```

The successful build prints:

```text
target=/private/tmp/poe-ralph-npm-build-probe.Nn3Bw3/outside files=discovery.d.ts,discovery.js,frontmatter.d.ts,frontmatter.js,index.d.ts,index.d.ts,index.js,index.js,ralph.d.ts,ralph.js,simulation.d.ts,simulation.js,types.d.ts,types.js
```

## Observed Behavior

The Ralph package builds through `tsc` into `dist`, with no canonical destination check before writing through an external symlink.

## Expected Behavior

Ralph workflow artifacts should be emitted only beneath canonical `packages/ralph/dist`, rejecting output symlink escapes.

## Impact

A regular workflow-runner build can overwrite external files when its output directory is redirected, without a failed build signaling the mutation.
