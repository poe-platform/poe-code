# Skill validation errors exit successfully

## Summary

`skill configure` and `skill unconfigure` print validation errors for invalid input but exit with status `0`, so automation cannot detect failed skill-management requests.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory

## Reproduction

From the repository root, run invalid skill requests and print each exit status:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
while IFS='|' read -r label args; do
  out="$probe/$label.out"
  (
    cd "$probe/project" &&
    HOME="$probe/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" ${=args}
  ) >"$out" 2>&1
  exit_code=$?
  printf '\ncommand=%s\nexit=%s\n' "$args" "$exit_code"
  cat "$out"
done <<'EOF_CASES'
configure-unknown|skill configure not-a-real-agent --yes
configure-conflict|skill configure claude-code --local --global
unconfigure-unknown|skill unconfigure not-a-real-agent --global
unconfigure-conflict|skill unconfigure claude-code --local --global
EOF_CASES
```

## Observed Behavior

- `skill configure not-a-real-agent --yes` prints `Unknown agent: not-a-real-agent` and exits `0`.
- `skill configure claude-code --local --global` prints `Use either --local or --global, not both.` and exits `0`.
- `skill unconfigure not-a-real-agent --global` prints `Unknown agent: not-a-real-agent` and exits `0`.
- `skill unconfigure claude-code --local --global` prints `Use either --local or --global, not both.` and exits `0`.

## Expected Behavior

Commands that reject invalid agent names or mutually exclusive scope options should exit non-zero so shell scripts and calling tools can distinguish failure from successful configuration changes.

## Impact

- Automated setup and cleanup workflows can silently proceed after a skill operation failed.
- CI checks cannot reliably assert that a requested skill target or scope was valid.
- Human-visible error styling is inconsistent with the command's machine-readable result.

## Supporting Evidence

In `src/cli/commands/skill.ts`, both actions call `resources.logger.error(...)` and then `return` for mutually exclusive scope options and unknown or unsupported agent resolution. Those branches do not throw and do not set `process.exitCode`, leaving the CLI process successful despite reporting an error.

## Suspected Area

Skill command validation branches should propagate a command failure through the CLI's standard error path or explicitly set a non-zero exit status before returning.
