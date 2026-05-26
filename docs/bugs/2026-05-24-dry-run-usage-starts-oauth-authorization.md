# Dry-run usage starts OAuth authorization

## Summary

Running `usage` or `usage list` with root `--dry-run` and no available API key starts an interactive Poe OAuth authorization flow instead of merely previewing the usage request.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a bounded probe terminated after observing OAuth startup

## Reproduction

From the repository root, execute either usage preview with an empty disposable home. The process waits for authorization, so terminate it after observing the output:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes usage
)
```

Repeating the final invocation with `--dry-run --yes usage list --pages 1` exhibits the same behavior.

## Observed Behavior

- `usage` prints an `Authorize at https://poe.com/oauth/authorize?...redirect_uri=http://127.0.0.1:<port>/callback` URL and enters `Waiting for authorization. You can also paste the redirect URL here:`.
- `usage list --pages 1` likewise creates an authorization URL and waits for the OAuth completion callback instead of returning its dry-run preview.
- The process must be interrupted because it opens an interactive authentication operation in a command advertised as simulation-only.

## Expected Behavior

With root `--dry-run`, usage commands without credentials must not initiate OAuth authorization, open a callback listener, or wait for interactive authentication. They should preview that credentials would be required and that a usage request would be performed.

## Impact

- A non-invasive usage preview becomes an interactive login operation that can open a browser and block automation.
- Dry-run invocations unexpectedly start local OAuth callback handling and user-facing authentication work.
- Users cannot safely preview usage behavior on fresh installations or logged-out environments.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/usage.ts`, both usage paths call `container.options.resolveApiKey({ dryRun: flags.dryRun })` before their dry-run early return. In `src/cli/options.ts`, when no supplied, environment, or stored value exists, `resolveApiKey(...)` calls `init.loginViaOAuth()` regardless of `input.dryRun`; `src/cli/oauth-login.ts` creates an OAuth authorization, attempts to open its URL, and waits for a callback result.

## Suspected Area

Dry-run usage must avoid credential acquisition flows entirely and emit a preview without invoking OAuth.
