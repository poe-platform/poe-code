# Dry-run models migrates legacy credentials before previewing API fetch

## Summary

Running `models` with the root `--dry-run` option creates a provider-specific credential file when only the legacy credential file exists, even though the command reports only that it would fetch models.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable `HOME`

## Reproduction

From the repository root, create an encrypted legacy credential in a disposable home and invoke `models` in dry-run mode:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"

HOME="$probe/home" /path/to/poe-code/node_modules/.bin/tsx -e \
  "import { EncryptedFileStore } from '/path/to/poe-code/packages/auth-store/src/encrypted-file-store.ts'; void (async () => { const store = new EncryptedFileStore({ filePath: process.env.HOME + '/.poe-code/credentials.enc', salt: 'poe-code:encrypted-file-auth-store:v1' }); await store.set('legacy-models-probe-key'); })();"

find "$probe/home/.poe-code" -maxdepth 1 -type f -print
(
  cd "$probe/project"
  HOME="$probe/home" /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run models
)
find "$probe/home/.poe-code" -maxdepth 1 -type f -print
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- Before the command, only `$HOME/.poe-code/credentials.enc` exists.
- The command prints `Dry run: would fetch models from Poe API.`
- After the dry run, `$HOME/.poe-code/credentials.poe.enc` also exists.

## Expected Behavior

With root `--dry-run`, `models` must not migrate or create credential files while previewing a model API request. It should either avoid reading migratory credential storage or preview any intended migration without writing it.

## Impact

- A read-oriented model listing preview mutates authentication state on disk.
- The output claims only a simulated API request while omitting the credential migration that already occurred.
- Users cannot safely preview `models` in environments that still hold legacy credentials.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/models.ts`, the command calls `container.readApiKey()` before checking `flags.dryRun`. In `src/cli/container.ts`, Poe credential reads are wrapped with `MigratingSecretStore`, whose `get()` implementation in `packages/auth-store/src/provider-store.ts` copies a legacy credential into the provider-specific primary store.

## Suspected Area

Model listing must check dry-run before migratory credential reads, or credential reads used by preview-only commands must support a non-persisting mode.
