# MCP unconfigure reports removal when no config exists

## Summary

Running `mcp unconfigure` for a supported client with no MCP configuration file present reports that configuration was removed, even though the operation is a no-op.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with an empty disposable home/project directory

## Reproduction

From the repository root, invoke MCP cleanup in a new home that has no Codex configuration file:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes mcp unconfigure codex
)
find "$probe/home" -type f -print | sort
```

## Observed Behavior

- Before invocation, the disposable home contains no `~/.codex/config.toml` or MCP configuration state.
- The command exits successfully and prints `Removed MCP configuration from codex.`.
- The post-command file listing remains empty, confirming that no configuration existed or was removed.

## Expected Behavior

When no target MCP server entry exists, unconfigure should report that no MCP configuration was found or no changes were necessary rather than claiming removal.

## Impact

- Users are told cleanup occurred when nothing was configured.
- Automation cannot distinguish a verified removal from a no-op against an already absent integration.
- The message obscures whether cleanup actually addressed persisted state, especially when investigating credential or ownership issues.

## Supporting Evidence

In `src/cli/commands/mcp.ts`, the unconfigure handler always completes with `Removed MCP configuration from ${resolvedAgent}.` after awaiting the package operation. `packages/agent-mcp-config/src/apply.ts` allows `unconfigure(...)` to return without a mutation when the target file or entry does not exist, but it does not return a changed/no-op result for the CLI to report accurately.

## Suspected Area

MCP unconfigure should return mutation outcome information and render distinct completion text for changed versus absent configuration.
