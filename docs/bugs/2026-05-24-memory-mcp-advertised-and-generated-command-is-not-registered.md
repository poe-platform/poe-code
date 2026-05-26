# Memory MCP configuration targets an unregistered `memory-mcp` command

## Summary

The memory package advertises `poe-code memory-mcp` as its stdio MCP server and emits MCP configuration entries that launch `poe-code memory-mcp`, but the main `poe-code` CLI does not register a `memory-mcp` command. Consequently, the documented MCP startup command fails and configuration generated for `poe-code-memory` points at a nonexistent executable path.

## Reproduction

From the repository root, run the source CLI in an isolated home:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"

(
  cd "$probe/project" || exit 1

  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" memory-mcp

  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" memory-mcp --print-mcp-config
)

nl -ba packages/memory/README.md | sed -n '43,108p'
nl -ba packages/memory/src/install.ts | sed -n '56,66p'
nl -ba packages/memory/src/mcp.ts | sed -n '72,86p'
rg -n 'register.*Command|memory-mcp' src/cli/program.ts package.json
```

## Observed Behavior

Invoking the documented server command fails with an unknown-command error:

```text
Unknown command: memory-mcp
Run npm run dev -- --help for available commands.
```

Invoking its documented config-printing option also exits with failure:

```text
error: unknown option '--print-mcp-config'
```

Nevertheless, `packages/memory/README.md` states that `poe-code memory-mcp` exposes memory over stdio and shows MCP configuration with `"args": ["memory-mcp"]`. The implementation also emits that dead launch target in both `installMemory()` and `printMcpConfig()`, while `src/cli/program.ts` has no corresponding registration and `package.json` has no separate `memory-mcp` binary.

## Expected Behavior

The MCP command path written into memory installation/configuration output should launch a registered stdio MCP server, and the documented `--print-mcp-config` invocation should succeed. Alternatively, no generated configuration or documentation should refer to an unavailable command.

## Impact

Any user or SDK consumer who installs or manually configures the advertised `poe-code-memory` MCP server receives a launch command that cannot start. Agents configured through that entry cannot access memory tools, even though the package exposes the server implementation and claims the MCP integration is available.
