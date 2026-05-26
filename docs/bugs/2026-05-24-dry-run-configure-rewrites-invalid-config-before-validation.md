# Dry-run configure rewrites invalid config before validation

## Summary

Running `configure` with `--dry-run --yes` and no explicit agent rewrites malformed global configuration while selecting the default agent, even when the command subsequently fails API-key validation before applying configuration changes.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable home with malformed configuration and execute a configuration dry-run using a rejected placeholder key:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
printf '{ invalid json\n' > "$probe/home/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" POE_CODE_OAUTH_LOGIN=0 npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes configure \
      --api-key probe-key --model test-model --provider poe
)

find "$probe/home/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command resolves `claude-code`, starts `Poe - configure claude-code`, then fails with `Error: API key rejected.`
- Before reporting that validation failure, `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the malformed original.

## Expected Behavior

A `--dry-run` configure attempt must not persist configuration repairs, including while choosing defaults or validating inputs before a proposed configuration is accepted.

## Impact

- A failed configuration preview modifies user configuration despite making no valid requested configuration change.
- Validation failures can hide an unrelated, irreversible-at-the-original-path recovery mutation.
- Automated setup validation can dirty user state even when it reports failure.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/configure.ts` resolves an omitted service through `resolveServiceArgument` before executing provider/API-key validation; that helper calls `resolveDefaultAgent`, and invalid-document recovery in `packages/poe-code-config/src/store.ts` writes replacement and backup files.

## Suspected Area

Configure default selection needs non-mutating reads in dry-run mode, and invalid configuration recovery must not occur before validation in a preview operation.
