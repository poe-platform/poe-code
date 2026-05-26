# Dry-run command error creates error log

## Summary

Running a command that fails validation under `--dry-run` creates a persistent error log in the user's poe-code home directory, even when no configuration or project files existed beforehand.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, invoke a locally validated runtime preview that cannot succeed by design:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"

(
  cd "$probe/project"
  HOME="$probe/home" /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run runtime build --runtime host
)

find "$probe/home" -maxdepth 6 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command fails as expected with `Host runtime has no template to build.`
- It creates `$HOME/.poe-code/logs/errors.log` containing the validation error and stack trace.

## Expected Behavior

With `--dry-run`, validation failures should be reported to the terminal without persisting log files or creating user-state directories. If logging during previews is required, it must be explicitly disclosed as an exception to the no-write contract.

## Impact

- Any unsuccessful preview can dirty a previously clean home directory.
- CI and diagnostic probes using temporary state cannot rely on dry-run being side-effect free.
- Error-log writes make the advertised no-write contract inaccurate even for commands with otherwise clean preview behavior.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. Error handling in `src/cli/bootstrap.ts` initializes the error log path and calls `errorLogger.logErrorWithStackTrace` when command execution throws, without excluding dry-run executions.

## Suspected Area

Dry-run failure handling needs non-persistent diagnostics, or the CLI contract must explicitly carve out logging writes.
