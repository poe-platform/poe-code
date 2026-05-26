# Poe agent build symlinked dist directory writes outside package

## Summary

The `@poe-code/poe-agent` build emits agent implementation modules and copies `SYSTEM_PROMPT.md` into `dist` without verifying output-root containment. A symlinked output directory redirects all of these build writes externally.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-poe-agent-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/poe-agent" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/poe-agent/src "$probe/packages/poe-agent/"
cp packages/poe-agent/package.json packages/poe-agent/tsconfig.json "$probe/packages/poe-agent/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/poe-agent/dist"
(cd "$probe/packages/poe-agent" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/poe-agent/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -14 | paste -sd, -
test -f "$probe/outside/agent.js" && test -f "$probe/outside/SYSTEM_PROMPT.md"
rm -rf "$probe"
```

The build succeeds and emits:

```text
target=/private/tmp/poe-poe-agent-npm-build-probe.ODHKH4/outside files=SYSTEM_PROMPT.md,acp-core.d.ts,acp-core.js,agent-host.d.ts,agent-host.js,agent-session-options.compile-check.d.ts,agent-session-options.compile-check.js,agent-session.d.ts,agent-session.js,agent.d.ts,agent.js,config.d.ts,config.js,errors.d.ts
```

## Observed Behavior

The build emits TypeScript output and then copies `src/SYSTEM_PROMPT.md` into `dist`, without rejecting a symlinked destination that resolves outside `poe-agent`.

## Expected Behavior

Compiled agent modules and system prompt assets should be written only under canonical `packages/poe-agent/dist`, refusing external output links.

## Impact

An ordinary agent build can overwrite external files with executable modules and system-instruction content in a manipulated workspace.
