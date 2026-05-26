# Agent child process build symlinked dist directory writes outside package

## Summary

The `@poe-code/agent-child-process` build compiles directly into `dist` without rejecting a symlinked output directory. A routine package build therefore writes generated process-helper artifacts into an external symlink target.

## Reproduction

From the repository root, run a disposable linked-output build:

```sh
probe=$(mktemp -d /tmp/poe-agent-child-process-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/agent-child-process" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/agent-child-process/src "$probe/packages/agent-child-process/"
cp packages/agent-child-process/package.json packages/agent-child-process/tsconfig.json "$probe/packages/agent-child-process/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/agent-child-process/dist"
(cd "$probe/packages/agent-child-process" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/agent-child-process/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/index.d.ts"
rm -rf "$probe"
```

The successful reproduction prints output beneath the external target:

```text
target=/private/tmp/poe-agent-child-process-npm-build-probe.6ihMFm/outside files=index.d.ts,index.js
```

## Observed Behavior

`packages/agent-child-process/package.json:15` executes `tsc`; `packages/agent-child-process/tsconfig.json:4` assigns `dist` as `outDir`. The build follows a pre-existing `dist` symlink and emits externally without a containment check.

## Expected Behavior

Package builds should emit only inside the canonical `packages/agent-child-process/dist` directory and reject output roots that resolve outside the package.

## Impact

A crafted checkout or stale symlink lets a normal build overwrite arbitrary external files with generated child-process modules while the command succeeds.
