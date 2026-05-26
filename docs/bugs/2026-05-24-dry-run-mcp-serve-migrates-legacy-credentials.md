# Dry-run MCP serve migrates legacy credentials while starting server path

## Summary

Running `mcp serve` with the root `--dry-run` option creates a provider-specific credential file from legacy credentials instead of performing a no-write preview.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable `HOME` and closed stdin

## Reproduction

From the repository root, create an encrypted legacy credential in a disposable home and invoke `mcp serve` in dry-run mode with end-of-file stdin so the server exits without interactive use:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"

HOME="$probe/home" /path/to/poe-code/node_modules/.bin/tsx -e \
  "import { EncryptedFileStore } from '/path/to/poe-code/packages/auth-store/src/encrypted-file-store.ts'; void (async () => { const store = new EncryptedFileStore({ filePath: process.env.HOME + '/.poe-code/credentials.enc', salt: 'poe-code:encrypted-file-auth-store:v1' }); await store.set('legacy-mcp-serve-probe-key'); })();"

find "$probe/home/.poe-code" -maxdepth 1 -type f -print
(
  cd "$probe/project"
  HOME="$probe/home" /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run mcp serve </dev/null
)
find "$probe/home/.poe-code" -maxdepth 1 -type f -print
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- Before the command, only `$HOME/.poe-code/credentials.enc` exists.
- `--dry-run mcp serve` exits successfully after stdin closes, without reporting a dry-run preview.
- During that invocation, it creates `$HOME/.poe-code/credentials.poe.enc` from the legacy credential.

## Expected Behavior

With root `--dry-run`, `mcp serve` must not enter the server startup path or persist credential migration. It should preview that the MCP server would be started without reading migratory authentication state or making filesystem changes.

## Impact

- A preview of server startup mutates encrypted credential storage on disk.
- The command silently ignores the dry-run contract rather than identifying the action it would perform.
- Automation cannot safely validate the MCP serve command wiring under dry-run when legacy credentials exist.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/mcp.ts`, `mcp serve` calls `runMcpServer(container, ...)` without resolving or honoring root command flags. `runMcpServer` calls `container.readApiKey()`, and `src/cli/container.ts` wraps Poe credential reads with `MigratingSecretStore`, whose `get()` method in `packages/auth-store/src/provider-store.ts` persists legacy credentials into the provider-specific store.

## Suspected Area

`mcp serve` needs root dry-run handling before server initialization and before any migratory credential lookup.
