# Dry-run usage commands migrate legacy credentials

## Summary

Running `usage` or `usage list` with the root `--dry-run` option still creates a provider-specific credential file while resolving the stored Poe API key.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable encrypted-file credential storage

## Reproduction

From the repository root, create a disposable home directory containing only the legacy encrypted Poe credential, then preview either usage command:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
HOME="$probe/home" /path/to/poe-code/node_modules/.bin/tsx --eval \
  "import { EncryptedFileStore } from './packages/auth-store/src/encrypted-file-store.ts'; void (async () => { const store = new EncryptedFileStore({ filePath: process.env.HOME + '/.poe-code/credentials.enc', salt: 'poe-code:encrypted-file-auth-store:v1' }); await store.set('legacy-probe-key'); })();"

find "$probe/home/.poe-code" -maxdepth 1 -type f -print
(
  cd "$probe/project"
  HOME="$probe/home" /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run usage
)
find "$probe/home/.poe-code" -maxdepth 1 -type f -print
```

Replace `/path/to/poe-code` with the repository checkout path. Repeating with `--dry-run usage list --pages 1` produces the same new credential file.

## Observed Behavior

- Before either command, only `$HOME/.poe-code/credentials.enc` exists.
- `usage` prints `Dry run: would fetch usage balance from Poe API.` yet creates `$HOME/.poe-code/credentials.poe.enc`.
- `usage list --pages 1` prints `Dry run: would fetch usage history from Poe API.` and creates the same provider-specific credential file.

## Expected Behavior

With root `--dry-run`, usage previews must not migrate or create credential files while avoiding network requests. They should resolve preview output without persistence.

## Impact

- The commands accurately promise to skip remote usage requests but silently change encrypted credential storage locally.
- Credential migration occurs during routine billing/history inspection without an explicit auth action.
- Automation cannot use dry-run usage commands as a no-write validation step.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/usage.ts` resolves the API key before its dry-run early return; for Poe, `src/cli/container.ts` exposes a `MigratingSecretStore`, whose `get()` method in `packages/auth-store/src/provider-store.ts` writes a legacy credential into the provider-specific store.

## Suspected Area

Usage preview commands and credential migration need a non-persisting read mode when dry-run is active.
