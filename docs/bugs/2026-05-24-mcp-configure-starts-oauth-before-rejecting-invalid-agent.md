# MCP configure starts OAuth before rejecting invalid agent

## Summary

In a logged-out environment, `mcp configure` starts interactive Poe OAuth authentication before checking whether the requested target agent is unknown or unsupported. Invalid requests that could be rejected immediately instead launch a browser-based authorization flow and wait indefinitely.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and timeout-bounded processes to capture the unwanted OAuth wait

## Reproduction

From the repository root, run MCP configuration for one unknown and one unsupported client without any stored or environment credential:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/unknown/home" "$probe/unknown/project" \
  "$probe/unsupported/home" "$probe/unsupported/project"
(
  cd "$probe/unknown/project" &&
  HOME="$probe/unknown/home" \
    perl -e 'alarm shift; exec @ARGV' 2 \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes mcp configure not-a-real-agent --yes
) > "$probe/unknown.out" 2>&1 || true
(
  cd "$probe/unsupported/project" &&
  HOME="$probe/unsupported/home" \
    perl -e 'alarm shift; exec @ARGV' 2 \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes mcp configure gemini-cli --yes
) > "$probe/unsupported.out" 2>&1 || true
cat "$probe/unknown.out"
cat "$probe/unsupported.out"
```

## Observed Behavior

- `mcp configure not-a-real-agent --yes` does not immediately print `Unknown agent`; it prints `Poe - login`, creates an OAuth authorization URL, and waits for authorization until terminated by the timeout.
- `mcp configure gemini-cli --yes` likewise does not immediately print `MCP not supported for gemini-cli.`; it starts the same OAuth authorization flow and waits.
- Neither invalid request reaches the agent-support validation output before attempting authentication.

## Expected Behavior

MCP configuration must validate the requested client before initiating authentication. Unknown or unsupported agents should be rejected immediately and non-interactively without opening or waiting on OAuth.

## Impact

- Typos and unsupported target choices unexpectedly initiate sensitive authentication flows.
- CI and automation can hang waiting for login on requests that can never produce a valid MCP configuration.
- The command needlessly asks users to authenticate before revealing that their requested action is invalid.

## Supporting Evidence

In `src/cli/commands/mcp.ts`, the `mcp configure` handler reads or resolves an API key, potentially entering OAuth, before it computes `resolveAgentSupport(agent)`. The `unknown` and `unsupported` checks occur only after authentication has completed or blocked.

## Suspected Area

MCP configure should resolve and validate the target agent before performing any credential lookup or interactive login operation.
