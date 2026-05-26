# Agent eval build symlinked dist directory writes outside package

## Summary

The `@poe-code/agent-eval` build emits evaluation, cloning, and checker modules into `dist` without verifying the canonical output location. A symlinked `dist` redirects the successful package build into an external directory.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-agent-eval-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/agent-eval" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/agent-eval/src "$probe/packages/agent-eval/"
cp packages/agent-eval/package.json packages/agent-eval/tsconfig.json "$probe/packages/agent-eval/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/agent-eval/dist"
(cd "$probe/packages/agent-eval" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/agent-eval/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -14 | paste -sd, -
test -f "$probe/outside/aggregate.js" && test -f "$probe/outside/commands.js"
rm -rf "$probe"
```

The reproduction succeeds:

```text
target=/private/tmp/poe-agent-eval-npm-build-probe.290U1t/outside files=aggregate.d.ts,aggregate.js,budget.d.ts,budget.js,cheat.d.ts,cheat.js,check.d.ts,check.d.ts,check.js,check.js,clone.d.ts,clone.js,commands.d.ts,commands.js
```

## Observed Behavior

The package `tsc` build emits into `dist`, and follows an external output symlink without containment validation before writing the evaluator artifact tree.

## Expected Behavior

Agent-eval build output should remain under canonical `packages/agent-eval/dist`, rejecting escaped symlink destinations.

## Impact

A routine evaluation package build can overwrite external files in a crafted workspace while returning success.
