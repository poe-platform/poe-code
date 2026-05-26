# Dry-run login starts OAuth authorization

## Summary

Running `login` with root `--dry-run` and no supplied API key starts an interactive Poe OAuth authorization flow instead of previewing login behavior.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a bounded probe terminated after observing OAuth startup

## Reproduction

From the repository root, invoke a login preview without an API key. The process waits for authorization, so terminate it after observing the output:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes login
)
```

## Observed Behavior

- The CLI prints an `Authorize at https://poe.com/oauth/authorize?...redirect_uri=http://127.0.0.1:<port>/callback` URL.
- It enters `Waiting for authorization. You can also paste the redirect URL here:` and does not complete as a simulation.
- The process must be interrupted after a live OAuth operation has been initiated.

## Expected Behavior

With root `--dry-run`, `login` must not initiate OAuth authorization, attempt browser launch, or wait for an authentication callback. It should preview what credential storage or service reconfiguration would occur after authentication.

## Impact

- A login preview starts a user-facing authentication transaction and blocks unattended execution.
- Dry-run can open a browser and establish callback handling despite promising a simulation.
- Users cannot inspect login-side reconfiguration behavior safely before deciding to authenticate.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/login.ts`, `executeLogin(...)` passes `dryRun: true` to `container.options.resolveApiKey(...)` even for a root dry-run invocation. In `src/cli/options.ts`, if no credential value is supplied, `resolveApiKey(...)` calls `init.loginViaOAuth()` without guarding on `input.dryRun`; `src/cli/oauth-login.ts` creates an OAuth authorization, attempts browser launch, and waits for authorization completion.

## Suspected Area

Dry-run login should terminate before credential acquisition and display a preview of post-authentication operations only.
