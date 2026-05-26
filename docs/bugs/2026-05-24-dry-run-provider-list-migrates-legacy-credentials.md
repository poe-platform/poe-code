# Dry-run provider list migrates legacy credentials

## Summary

Running `provider list` with the root `--dry-run` option still writes a provider-specific credential file when only the legacy Poe credential file exists.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable encrypted-file credential storage

## Reproduction

From the repository root, create a disposable home directory containing only the legacy encrypted Poe credential, then list providers in dry-run mode:

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
    /path/to/poe-code/src/index.ts --dry-run provider list
)
find "$probe/home/.poe-code" -maxdepth 1 -type f -print
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- Before the command, only `$HOME/.poe-code/credentials.enc` exists.
- The command reports Poe as `[logged in]` and creates `$HOME/.poe-code/credentials.poe.enc` during the dry-run listing operation.
- No login or mutation command is requested; the write occurs while reading provider login status.

## Expected Behavior

With root `--dry-run`, listing provider status must not migrate or create credential files. It should read existing status without persistence, or explicitly preview a pending credential migration.

## Impact

- A read-oriented preview writes encrypted credential material to a new path.
- Credential storage migration occurs without an explicit login, migration, or mutating command.
- Users cannot audit provider status under dry-run without changing authentication state on disk.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/provider.ts` calls `container.providerRegistry.isLoggedIn(...)` for `provider list`; for Poe, `src/cli/container.ts` wraps the provider store in `MigratingSecretStore`, and `packages/auth-store/src/provider-store.ts` writes the legacy value into the primary provider-specific store from `get()`.

## Suspected Area

Credential migration must be opt-in or dry-run-aware when provider status commands only intend to inspect authentication state.
