---
name: "Usage commands ignore Poe environment credential and start OAuth"
---

# Usage commands ignore Poe environment credential and start OAuth

## Summary

Running `usage` or `usage list` with `POE_API_KEY` already set still ignores the available environment credential and starts interactive Poe OAuth authorization instead of fetching usage information non-interactively.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and timeout-bounded processes to capture unwanted OAuth waits

## Reproduction

From the repository root, run both usage commands in clean homes with only an environment API key available:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/balance/home" "$probe/balance/project" \
  "$probe/list/home" "$probe/list/project"
(
  cd "$probe/balance/project" &&
  HOME="$probe/balance/home" POE_API_KEY=environment-usage-key \
    perl -e 'alarm shift; exec @ARGV' 2 \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes usage
) > "$probe/balance.out" 2>&1 || true
(
  cd "$probe/list/project" &&
  HOME="$probe/list/home" POE_API_KEY=environment-list-key \
    perl -e 'alarm shift; exec @ARGV' 2 \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes usage list
) > "$probe/list.out" 2>&1 || true
cat "$probe/balance.out"
cat "$probe/list.out"
```

## Observed Behavior

- `POE_API_KEY=environment-usage-key poe-code --yes usage` prints `Poe - usage balance`, then immediately emits an OAuth authorization URL and waits for authorization until terminated by the timeout.
- `POE_API_KEY=environment-list-key poe-code --yes usage list` prints `Poe - usage list`, then emits the same interactive OAuth flow and waits.
- Neither command uses the supplied environment credential to reach its intended usage API request.

## Expected Behavior

Usage commands must accept active `POE_API_KEY` environment authentication consistently with other Poe-backed command paths and perform their API reads without launching OAuth.

## Impact

- CI and shell users authenticated through environment variables cannot query balances or usage history non-interactively.
- Routine usage inspection unexpectedly opens an interactive authorization flow and can hang unattended automation.
- Authentication behavior is inconsistent across commands operating on the same Poe account credential.

## Supporting Evidence

In `src/cli/commands/usage.ts`, both `executeBalance(...)` and the `usage list` handler call `container.options.resolveApiKey({ dryRun: flags.dryRun })` without providing `envValue: container.env.getVariable("POE_API_KEY")`. In `src/cli/options.ts`, environment credentials are considered only when passed explicitly; otherwise absence of a stored key falls through to OAuth.

## Suspected Area

Usage commands should use unified credential resolution that includes `POE_API_KEY` before initiating interactive authentication.
