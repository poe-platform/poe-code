# MCP configure ignores Poe environment credential and starts OAuth

## Summary

Running `mcp configure` with `POE_API_KEY` already set still treats the user as unauthenticated and starts the interactive Poe OAuth authorization flow before configuring the explicitly requested MCP client.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory and a time-bounded process to capture the unwanted OAuth wait

## Reproduction

From the repository root, provide an environment credential and request an explicit MCP client non-interactively:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
(
  cd "$probe/project" &&
  HOME="$probe/home" POE_API_KEY=environment-mcp-key \
    perl -e 'alarm shift; exec @ARGV' 2 \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" mcp configure codex --yes
) > "$probe/out" 2>&1 || true
cat "$probe/out"
find "$probe/home" "$probe/project" -type f -print | sort
```

## Observed Behavior

- The command does not proceed to `mcp configure codex` despite the explicit agent argument and `POE_API_KEY=environment-mcp-key`.
- Instead, it prints `Poe - login`, emits an OAuth authorization URL, and waits for authorization until terminated by the probe timeout.
- No MCP client configuration file is written before the unwanted authentication flow begins.

## Expected Behavior

`mcp configure` must recognize the same valid `POE_API_KEY` environment authentication accepted by other Poe credential resolution paths and configure the explicitly requested MCP client without launching OAuth.

## Impact

- CI and shell workflows that authenticate via environment variable cannot non-interactively configure MCP clients.
- A command with all necessary inputs unexpectedly attempts browser-based interactive authentication.
- The authentication behavior is inconsistent with provider and auth commands that acknowledge environment-backed Poe credentials.

## Supporting Evidence

In `src/cli/commands/mcp.ts`, `mcp configure` checks only `await container.readApiKey()` before initiating `container.options.resolveApiKey(...)`; it does not pass `POE_API_KEY` as an environment credential candidate. When no stored key exists, the option resolver falls into OAuth even though an active environment credential is present.

## Suspected Area

MCP configuration should use unified Poe credential resolution, including environment-backed authentication, before initiating interactive login.
