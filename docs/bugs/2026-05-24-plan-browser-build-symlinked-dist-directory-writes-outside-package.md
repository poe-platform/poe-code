# Plan browser build symlinked dist directory writes outside package

## Summary

The `@poe-code/plan-browser` build compiles plan discovery and action modules into a fixed `dist` output directory without symlink-containment checks. A linked output root redirects emitted code into an external location.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-plan-browser-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/plan-browser" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/plan-browser/src "$probe/packages/plan-browser/"
cp packages/plan-browser/package.json packages/plan-browser/tsconfig.json "$probe/packages/plan-browser/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/plan-browser/dist"
(cd "$probe/packages/plan-browser" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/plan-browser/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -12 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/discovery.js"
rm -rf "$probe"
```

The reproduction succeeds and prints:

```text
target=/private/tmp/poe-plan-browser-npm-build-probe.ZixqdG/outside files=actions.d.ts,actions.js,browser.d.ts,browser.js,discovery.d.ts,discovery.js,explorer-config.d.ts,explorer-config.js,format.d.ts,format.js,index.d.ts,index.js
```

## Observed Behavior

`packages/plan-browser/package.json` executes `tsc`, and its TypeScript output path is `dist`. An existing output-directory symlink is followed without rejecting its external destination.

## Expected Behavior

Plan-browser package builds should emit only inside canonical `packages/plan-browser/dist`, not through symlinks outside the package tree.

## Impact

Build operations can overwrite external files with plan-browser artifacts in a malicious or stale-symlink workspace while still returning success.
