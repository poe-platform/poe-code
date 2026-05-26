# Dry-run provider logout omits credential deletion

## Summary

Running `provider logout <id>` with root `--dry-run` reports `# no filesystem changes`, even though normal provider logout deletes the provider's encrypted credential file.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with separate disposable dry-run and normal home/project directories

## Reproduction

From the repository root, log in to Anthropic in two disposable homes and compare dry-run versus normal provider logout:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/dry/home" "$probe/dry/project" "$probe/live/home" "$probe/live/project"
seed() {
  (
    cd "$1/project" &&
    HOME="$1/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes provider login anthropic --api-key logout-secret
  ) >/dev/null
}
seed "$probe/dry"
seed "$probe/live"
(
  cd "$probe/dry/project" &&
  HOME="$probe/dry/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes provider logout anthropic
) > "$probe/dry/out" 2>&1
(
  cd "$probe/live/project" &&
  HOME="$probe/live/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes provider logout anthropic
) > "$probe/live/out" 2>&1
printf '%s\n' '=== dry-run output and files ==='
cat "$probe/dry/out"
find "$probe/dry/home/.poe-code" -type f -print | sort
printf '%s\n' '=== normal output and files ==='
cat "$probe/live/out"
find "$probe/live/home/.poe-code" -type f -print | sort || true
```

## Observed Behavior

- Before logout, both disposable homes contain `~/.poe-code/credentials.anthropic.enc`.
- Dry-run prints `Dry run: would log out from anthropic.` and `# no filesystem changes`, leaving the credential file in place as expected for a preview.
- Normal provider logout deletes `credentials.anthropic.enc`, but the deletion is absent from dry-run output.

## Expected Behavior

Dry-run must show that provider logout would delete the encrypted provider credential file, without performing the deletion.

## Impact

- Users cannot validate which stored credential artifact will be removed before logging out.
- Dry-run misleadingly reports no filesystem effect for a command whose core behavior is deleting a secret-bearing file.
- Security and cleanup workflows cannot rely on preview output to verify credential-removal scope.

## Supporting Evidence

In `src/cli/commands/provider.ts`, `container.providerRegistry.logout(id)` is skipped entirely under `flags.dryRun`, and no recorded file deletion is substituted before `resources.context.finalize()` renders `# no filesystem changes`. Normal execution delegates to the provider registry's encrypted credential store removal path.

## Suspected Area

Provider logout needs a dry-run-aware credential-store deletion preview that records the target encrypted credential file without mutating it.
