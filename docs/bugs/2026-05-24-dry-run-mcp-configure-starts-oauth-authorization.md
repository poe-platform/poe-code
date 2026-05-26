# Dry-run MCP configure starts OAuth authorization

## Summary

Running `mcp configure` with root `--dry-run` and no stored API key starts an interactive Poe OAuth authorization flow before it can preview MCP client configuration.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a bounded probe terminated after observing OAuth startup

## Reproduction

From the repository root, execute an MCP configuration preview with an empty disposable home. The process waits for authorization, so terminate it after observing the output:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes mcp configure codex
)
```

## Observed Behavior

- The CLI starts with `Poe - login` instead of an MCP configuration preview.
- It prints an `Authorize at https://poe.com/oauth/authorize?...redirect_uri=http://127.0.0.1:<port>/callback` URL and enters `Waiting for authorization. You can also paste the redirect URL here:`.
- The process must be interrupted rather than completing as a dry-run MCP configuration command.

## Expected Behavior

With root `--dry-run`, `mcp configure` without credentials must not start OAuth authorization or wait for an interactive login. It should preview whether authentication and MCP configuration would be needed without performing either action.

## Impact

- A configuration simulation can open a browser, start callback handling, and block CI or scripted previews.
- Users cannot evaluate MCP installation changes safely in a fresh or logged-out environment.
- The command enters an unrelated live authentication workflow before it reports any dry-run configuration effects.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/mcp.ts`, `mcp configure` calls `container.options.resolveApiKey({ dryRun: flags.dryRun })` when no existing key is available. In `src/cli/options.ts`, the no-credential fallback calls `init.loginViaOAuth()` regardless of `input.dryRun`; `src/cli/oauth-login.ts` creates an authorization URL, attempts browser launch, and waits for authorization completion.

## Suspected Area

Dry-run MCP configuration must avoid credential acquisition and represent login requirements only as preview output.
