# Dry-run mcp configure migrates legacy credentials while reporting no changes

## Summary

Running `mcp configure` with the root `--dry-run` option still creates a provider-specific credential file while ending with `# no filesystem changes`.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable encrypted-file credential storage

## Reproduction

From the repository root, create a disposable home directory containing only the legacy encrypted Poe credential, then preview MCP configuration for `codex`:

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
    /path/to/poe-code/src/index.ts --dry-run mcp configure codex --yes
)
find "$probe/home/.poe-code" -maxdepth 1 -type f -print
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- Before the command, only `$HOME/.poe-code/credentials.enc` exists.
- The command previews MCP config operations and prints `# no filesystem changes`.
- Despite that output, `$HOME/.poe-code/credentials.poe.enc` is created while the command reads the existing API key.

## Expected Behavior

With root `--dry-run`, MCP configuration preview must not migrate or create credential files, and it must not claim no filesystem changes after a credential write occurs.

## Impact

- The displayed dry-run summary is false while authentication state is modified.
- Credential migration occurs during MCP configuration inspection without an explicit login or migration command.
- Users cannot safely rely on the preview before altering editor/agent MCP configuration.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/mcp.ts` calls `container.readApiKey()` before invoking the dry-run-aware MCP config writer; for Poe, `src/cli/container.ts` uses `MigratingSecretStore`, whose `get()` method in `packages/auth-store/src/provider-store.ts` persists a legacy credential into the provider-specific store.

## Suspected Area

MCP preview commands need non-persisting credential reads and dry-run accounting for any implicit authentication migration.
