# Dry-run auth api-key migrates and prints secret

## Summary

Running `auth api-key` with the root `--dry-run` option still migrates a legacy credential file while reading and printing the stored secret value.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable encrypted-file credential storage

## Reproduction

From the repository root, create a disposable home directory containing only the legacy encrypted Poe credential, then invoke the API-key display command under dry-run:

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
    /path/to/poe-code/src/index.ts --dry-run auth api-key
)
find "$probe/home/.poe-code" -maxdepth 1 -type f -print
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- Before the command, only `$HOME/.poe-code/credentials.enc` exists.
- The command prints the plaintext test credential `legacy-probe-key`, as requested by `auth api-key`.
- The command also creates `$HOME/.poe-code/credentials.poe.enc` as an implicit migration during the read.

## Expected Behavior

With root `--dry-run`, `auth api-key` must not persist credential migration side effects while reading the key for display.

## Impact

- The display command silently writes a second encrypted credential file during a supposedly non-mutating invocation.
- Scripts using dry-run for safe credential inspection still alter credential state on disk.
- Credential migration happens without an explicit authentication or migration action.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/auth.ts` implements `executeApiKey` without accepting command flags or checking dry-run; its `container.readApiKey()` reaches the Poe `MigratingSecretStore`, whose `get()` method writes legacy credentials into the provider-specific store.

## Suspected Area

Sensitive auth display commands need explicit dry-run semantics, including non-persisting credential reads.
