# Dry-run generate media rewrites invalid configuration

## Summary

Running the `generate image`, `generate audio`, or `generate video` subcommand with `--dry-run` rewrites malformed global configuration while resolving the model for an otherwise non-executing media preview.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable home with malformed global configuration and preview a media generation command:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
printf '{ invalid json\n' > "$probe/home/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run generate image probe
)

find "$probe/home/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path. Repeating with `generate audio probe` or `generate video probe` produces the same filesystem mutation.

## Observed Behavior

- Each command reports a dry-run generation preview with its default media model and does not call the media API.
- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the malformed original.

## Expected Behavior

With `--dry-run`, resolving media models and previewing generation must not modify global configuration or create invalid-document recovery backups.

## Impact

- Previewing image, audio, or video generation silently alters user configuration.
- Media automation cannot validate model selection without risking local-state mutations.
- The malformed original configuration is moved before users explicitly choose repair.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. Media subcommands in `src/cli/commands/generate.ts` call `resolveModel` before checking `flags.dryRun`; model resolution uses `loadAgentModel` from `@poe-code/poe-code-config`, whose underlying invalid-document recovery in `packages/poe-code-config/src/store.ts` writes replacement and backup files.

## Suspected Area

Dry-run generation needs side-effect-free model configuration lookup, or config repair must require an explicit mutating action.
