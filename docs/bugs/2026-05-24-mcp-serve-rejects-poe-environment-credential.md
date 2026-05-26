# MCP serve rejects Poe environment credential

## Summary

Running `mcp serve` with `POE_API_KEY` set but no stored credential exits with `No API key found`, preventing the MCP server from using environment-provided authentication.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory and closed standard input

## Reproduction

From the repository root, start the MCP server with only an environment API key available:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
(
  cd "$probe/project" &&
  HOME="$probe/home" POE_API_KEY=environment-mcp-serve-key \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes mcp serve </dev/null
)
echo "exit=$?"
```

## Observed Behavior

- The command exits with status `1` immediately.
- It writes `No API key found. Run 'poe-code login' first.` to stderr.
- The available `POE_API_KEY=environment-mcp-serve-key` is not recognized as authentication for the MCP server.

## Expected Behavior

`mcp serve` must accept an active `POE_API_KEY` environment credential consistently with supported Poe SDK/account flows, allowing MCP clients to launch the server in environment-authenticated sessions without persistent login state.

## Impact

- MCP integrations cannot run in CI, ephemeral containers, or managed environments that intentionally provide secrets via environment variables instead of local files.
- Users may be forced to persist credentials on disk solely to run an MCP server.
- MCP authentication behavior contradicts other Poe entry points that advertise or accept `POE_API_KEY`.

## Supporting Evidence

In `src/cli/commands/mcp.ts`, `runMcpServer(...)` calls only `container.readApiKey()` and exits when that stored-key lookup is empty. It does not inspect `container.env.getVariable("POE_API_KEY")` or invoke an environment-aware credential resolver before initializing the client.

## Suspected Area

MCP server startup should resolve authentication through a shared environment-aware Poe credential path rather than requiring stored credentials exclusively.
