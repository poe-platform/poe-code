# Dry-run auth status migrates legacy credentials

## Summary

Running `auth status` with the root `--dry-run` option still creates a provider-specific credential file while checking whether the user is logged in.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable encrypted-file credential storage

## Reproduction

From the repository root, create a disposable home directory containing only the legacy encrypted Poe credential, then preview authentication status:

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
    /path/to/poe-code/src/index.ts --dry-run auth status
)
find "$probe/home/.poe-code" -maxdepth 1 -type f -print
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- Before the command, only `$HOME/.poe-code/credentials.enc` exists.
- The command prints `Dry run: would fetch identity from Poe API.` but also creates `$HOME/.poe-code/credentials.poe.enc`.
- The credential write occurs while resolving login status before the guarded network request would happen.

## Expected Behavior

With root `--dry-run`, authentication status inspection must not migrate or create credential files. Any planned credential migration should be previewed without persistence.

## Impact

- The command explicitly reports preview-only network behavior while silently writing credential state.
- Authentication audits can change encrypted storage layout without login or user approval.
- Automation cannot rely on dry-run status checks to avoid disk changes.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/auth.ts` calls `container.readApiKey()` before its dry-run network guard; for Poe, `src/cli/container.ts` uses `MigratingSecretStore`, whose `get()` method in `packages/auth-store/src/provider-store.ts` writes the legacy credential into the primary provider-specific store.

## Suspected Area

Authentication reads and credential migration need dry-run-aware, non-persisting inspection behavior.
