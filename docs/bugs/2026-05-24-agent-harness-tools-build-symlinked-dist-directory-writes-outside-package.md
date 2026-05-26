# Agent harness tools build symlinked dist directory writes outside package

## Summary

The `@poe-code/agent-harness-tools` TypeScript build emits execution and participant modules into `dist` without guarding against external symlink redirection. A standard build writes generated artifacts outside the package.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-agent-harness-tools-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/agent-harness-tools" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/agent-harness-tools/src "$probe/packages/agent-harness-tools/"
cp packages/agent-harness-tools/package.json packages/agent-harness-tools/tsconfig.json "$probe/packages/agent-harness-tools/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/agent-harness-tools/dist"
(cd "$probe/packages/agent-harness-tools" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/agent-harness-tools/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -14 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/execution-env.js"
rm -rf "$probe"
```

The build succeeds with external artifacts:

```text
target=/private/tmp/poe-agent-harness-tools-npm-build-probe.MQdbRP/outside files=binary-exists.d.ts,binary-exists.js,execution-env.d.ts,execution-env.js,hooks.d.ts,hooks.js,index.d.ts,index.js,lock.d.ts,lock.js,log-stream.d.ts,log-stream.js,participant.d.ts,participant.js
```

## Observed Behavior

The package compiles directly into `dist` without checking whether that destination remains within the package before following a symbolic link.

## Expected Behavior

Generated harness-tool artifacts should remain under canonical `packages/agent-harness-tools/dist`, rejecting external output links.

## Impact

A manipulated workspace redirects normal tool-package builds into arbitrary external overwrites while compilation succeeds.
