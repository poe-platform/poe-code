# Agent MCP config build symlinked dist directory writes outside package

## Summary

The `@poe-code/agent-mcp-config` TypeScript build writes MCP configuration modules into `dist` without validating that output directory's canonical location. A symlinked output root redirects normal build artifacts outside the package.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-agent-mcp-config-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/agent-mcp-config" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/agent-mcp-config/src "$probe/packages/agent-mcp-config/"
cp packages/agent-mcp-config/package.json packages/agent-mcp-config/tsconfig.json "$probe/packages/agent-mcp-config/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/agent-mcp-config/dist"
(cd "$probe/packages/agent-mcp-config" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/agent-mcp-config/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/apply.js"
rm -rf "$probe"
```

The successful build outputs:

```text
target=/private/tmp/poe-agent-mcp-config-npm-build-probe.eHzVSA/outside files=apply.d.ts,apply.js,configs.d.ts,configs.js,index.d.ts,index.js,shapes.d.ts,shapes.js,types.d.ts,types.js
```

## Observed Behavior

The package build command is `tsc`, and its TypeScript configuration emits beneath `dist`. The build follows an external output symlink without canonical-containment validation.

## Expected Behavior

Generated MCP configuration modules should remain beneath canonical `packages/agent-mcp-config/dist`, with escaped symlinks rejected.

## Impact

A normal build can become an external overwrite primitive in an untrusted checkout or stale output state.
