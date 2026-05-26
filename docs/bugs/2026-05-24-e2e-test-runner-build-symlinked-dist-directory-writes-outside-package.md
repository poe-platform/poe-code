# E2E test runner build symlinked dist directory writes outside package

## Summary

The `@poe-code/e2e-test-runner` package builds through `tsc -p tsconfig.build.json`, emitting JavaScript, declarations, and source maps beneath `dist` without rejecting external output symlinks. A standard build writes all of those artifacts outside the package tree when `dist` is redirected.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-e2e-test-runner-alt-build-probe.XXXXXX)
mkdir -p "$probe/packages/e2e-test-runner" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/e2e-test-runner/src "$probe/packages/e2e-test-runner/"
cp packages/e2e-test-runner/package.json packages/e2e-test-runner/tsconfig*.json "$probe/packages/e2e-test-runner/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/e2e-test-runner/dist"
(cd "$probe/packages/e2e-test-runner" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/e2e-test-runner/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -14 | paste -sd, -
test -f "$probe/outside/backend.js" && test -f "$probe/outside/backend.js.map"
rm -rf "$probe"
```

The build completes successfully with external output:

```text
target=/private/tmp/poe-e2e-test-runner-alt-build-probe.K0wYu4/outside files=backend.d.ts,backend.js,backend.js.map,cleanup.d.ts,cleanup.js,cleanup.js.map,credentials.d.ts,credentials.js,credentials.js.map,engine.d.ts,engine.js,engine.js.map,env-container.d.ts,env-container.js
```

## Observed Behavior

`packages/e2e-test-runner/package.json` runs `tsc -p tsconfig.build.json`; `packages/e2e-test-runner/tsconfig.build.json:4` sets `outDir` to `dist`. The build follows an external symlink output root without containment checks, including for generated source maps.

## Expected Behavior

E2E test-runner build files should remain beneath canonical `packages/e2e-test-runner/dist`, rejecting escaped output roots before any artifact emission.

## Impact

An ordinary test-runner build can overwrite unrelated external code, declarations, and source-map files in a compromised worktree while exiting successfully.
