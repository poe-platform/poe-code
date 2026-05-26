# Runner E2B build symlinked dist directory writes outside package

## Summary

The `@poe-code/runner-e2b` build emits its sandbox factory, SDK, and job handling modules to `dist` without verifying symlink containment. A linked output directory redirects a successful package build externally.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-runner-e2b-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/runner-e2b" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/runner-e2b/src "$probe/packages/runner-e2b/"
cp packages/runner-e2b/package.json packages/runner-e2b/tsconfig.json "$probe/packages/runner-e2b/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/runner-e2b/dist"
(cd "$probe/packages/runner-e2b" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/runner-e2b/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -12 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/sdk.js"
rm -rf "$probe"
```

The successful build prints:

```text
target=/private/tmp/poe-runner-e2b-npm-build-probe.VAOFtu/outside files=auth-scope.d.ts,auth-scope.js,factory.d.ts,factory.js,index.d.ts,index.js,job-handle.d.ts,job-handle.js,opened-env.d.ts,opened-env.js,sdk.d.ts,sdk.js
```

## Observed Behavior

`packages/runner-e2b/package.json:15` invokes TypeScript output into `dist`, configured at `packages/runner-e2b/tsconfig.json:4`, without rejecting a canonical destination outside the package.

## Expected Behavior

Runner-E2B artifacts should be emitted only under canonical `packages/runner-e2b/dist`, and symlink-redirection should fail before writes.

## Impact

An ordinary sandbox-runner build can become an unintended external file overwrite operation in a crafted workspace while reporting success.
