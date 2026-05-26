# Dry-run github-workflows prepare executes agent setup

## Summary

Running `github-workflows prepare` with the root `--dry-run` option still dispatches agent installation and configuration commands.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a fake `poe-code` binary on `PATH`

## Reproduction

From the repository root, create a disposable project and a fake `poe-code` executable that records nested commands:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project" "$probe/bin"
cat > "$probe/bin/poe-code" <<'SH'
#!/bin/sh
printf 'executed:%s\n' "$*" >> "$FAKE_MARKER"
exit 0
SH
chmod +x "$probe/bin/poe-code"

(
  cd "$probe/project"
  PATH="$probe/bin:$PATH" FAKE_MARKER="$probe/marker" HOME="$probe/home" \
    POE_API_KEY=probe-key /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run github-workflows prepare update-dependencies
)

cat "$probe/marker"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command exits successfully and reports `Prepared agent "codex" for automation "update-dependencies".`
- The fake nested executable records both `install codex --yes` and `configure codex --yes` executions.

## Expected Behavior

With root `--dry-run`, workflow preparation must not execute agent installation or configuration commands. It should preview which setup operations would run.

## Impact

- A preview can install binaries or rewrite developer-tool configuration through nested setup commands.
- Users cannot safely inspect workflow prerequisites before applying them.
- Preparation automation bypasses the root non-mutation guarantee before any workflow is run.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`, but forwarded Toolcraft flags do not include `--dry-run`. `packages/github-workflows/src/commands.ts` implements `prepare` by calling `setupWorkflowAgent`, and `packages/github-workflows/src/setup-agent.ts` unconditionally runs `poe-code install ... --yes` and `poe-code configure ... --yes`.

## Suspected Area

Forwarded preparation commands need root dry-run propagation and non-executing nested setup previews.
