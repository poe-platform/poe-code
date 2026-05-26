# Dry-run generate text rewrites invalid configuration

## Summary

Running `generate text` with `--dry-run` rewrites a malformed global configuration file while resolving the model to display in the preview. The invalid file is replaced with `{}` and copied into an `.invalid-<timestamp>.json` backup despite the no-write simulation contract.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable home with malformed Poe configuration and preview text generation:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
printf '{ invalid json\n' > "$probe/home/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run generate text 'hello'
)

find "$probe/home/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The command prints a dry-run message identifying the model it would use, but also changes files under the isolated home:

- `.poe-code/config.json` changes from malformed input to `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the original malformed input.

## Expected Behavior

With `--dry-run`, generating text must not write or repair configuration while resolving preview information. It should either read without mutation, report the configuration error, or use a non-persistent fallback.

## Impact

- Previewing an API request unexpectedly changes user configuration.
- The original invalid file is replaced before the user chooses whether to repair it.
- Automated dry-run checks can dirty home-directory state even when no generation occurs.

## Supporting Evidence

The root CLI describes `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. The generate command resolves its configured model through `loadAgentModel` before returning from its dry-run branch, while invalid configuration recovery in `packages/poe-code-config/src/store.ts` writes a replacement file and backup.

## Suspected Area

Model/config reads used by dry-run command previews need a non-mutating invalid-document policy, or configuration recovery must be deferred to explicit write/repair operations.
