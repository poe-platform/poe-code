# Dry-run runtime build rewrites invalid project configuration

## Summary

Running `runtime build` with `--dry-run` rewrites malformed project configuration before reporting that it would build a runtime template. The mutation occurs for both Docker and E2B runtime preview paths.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable project with malformed project configuration and preview either runtime build:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/.poe-code"
printf '{ invalid json\n' > "$probe/project/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run runtime build --runtime docker
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path. Re-running with `--runtime e2b` produces the same filesystem mutation.

## Observed Behavior

- The command reports `Dry run: would build docker runtime template.` or `Dry run: would build e2b runtime template.`
- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the malformed original.

## Expected Behavior

With `--dry-run`, runtime build previews must not modify project configuration or create recovery backup files before determining which build would run.

## Impact

- A runtime preview silently dirties the project worktree.
- Users inspecting Docker or E2B build behavior can lose the malformed file at its original path before deciding to repair it.
- Automation that relies on `--dry-run` being non-mutating receives an incorrect result.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/runtime/build.ts` calls `readMergedDocument` before its Docker and E2B dry-run guards, and invalid-document recovery in `packages/poe-code-config/src/store.ts` persists a replacement document and backup file.

## Suspected Area

Runtime build preview should use non-mutating configuration resolution, or invalid-document recovery should be deferred until an explicitly mutating operation.
