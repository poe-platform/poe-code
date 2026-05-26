# Agent Maestro build symlinked dist directory writes outside package

## Summary

The `@poe-code/agent-maestro` build writes compiled orchestration and fixture modules into `dist` without rejecting output-directory symlinks, allowing normal builds to emit files outside the package tree.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-agent-maestro-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/agent-maestro" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/agent-maestro/src "$probe/packages/agent-maestro/"
cp packages/agent-maestro/package.json packages/agent-maestro/tsconfig.json "$probe/packages/agent-maestro/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/agent-maestro/dist"
(cd "$probe/packages/agent-maestro" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/agent-maestro/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -12 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/advance.js"
rm -rf "$probe"
```

The successful reproduction prints:

```text
target=/private/tmp/poe-agent-maestro-npm-build-probe.RB6GJm/outside files=advance.d.ts,advance.js,event-collector.d.ts,event-collector.js,experiment.d.ts,experiment.js,fixtures.d.ts,fixtures.js,harness.d.ts,harness.js,index.d.ts,index.d.ts
```

## Observed Behavior

`packages/agent-maestro/package.json:19` invokes `tsc`, while `packages/agent-maestro/tsconfig.json:4` configures `dist` as `outDir`; the compiler follows an external symlink without package containment validation.

## Expected Behavior

Build output should remain beneath canonical `packages/agent-maestro/dist`, rejecting symlinked output roots before emission.

## Impact

A manipulated checkout or stale symlink redirects routine Maestro builds into external file overwrites while compilation succeeds.
