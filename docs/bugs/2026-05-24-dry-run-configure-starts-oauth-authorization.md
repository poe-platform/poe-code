# Dry-run configure starts OAuth authorization

## Summary

Running `configure` with root `--dry-run`, the Poe provider, and no supplied API key starts an interactive OAuth authorization flow before it can finish previewing configuration.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a bounded probe terminated after observing OAuth startup

## Reproduction

From the repository root, preview Poe-backed OpenCode configuration without providing credentials. The process waits for authorization, so terminate it after observing the output:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes configure opencode \
      --provider poe --model test-model
)
```

## Observed Behavior

- The CLI begins `Poe - configure opencode`, then prints an OAuth authorization URL with a local callback `redirect_uri`.
- It waits for authorization rather than returning redacted configuration previews.
- The process must be interrupted because the dry-run has entered a live credential acquisition operation.

## Expected Behavior

With root `--dry-run`, `configure --provider poe` without an available credential must not start OAuth authorization. It should preview configuration requirements and report that authentication would be needed.

## Impact

- A configuration preview can open a browser, start OAuth callback handling, and block scripts.
- Users cannot examine Poe-backed configuration output on a fresh setup without initiating login.
- Dry-run behavior changes from simulation to live authentication based only on whether a credential already exists.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/configure-payload.ts`, Poe payload creation calls `container.options.resolveApiKey({ ... dryRun: flags.dryRun ... })`. In `src/cli/options.ts`, a missing credential falls through to `init.loginViaOAuth()` without checking `input.dryRun`; `src/cli/oauth-login.ts` initiates and waits for OAuth authorization.

## Suspected Area

Dry-run configure should render proposed configuration without entering credential acquisition flows.
