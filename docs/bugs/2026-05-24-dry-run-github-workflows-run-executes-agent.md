# Dry-run github-workflows run executes agent

## Summary

Running `github-workflows run` with the root `--dry-run` option still executes the selected automation agent.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a fake `codex` binary on `PATH`

## Reproduction

From the repository root, create a disposable project and a fake `codex` executable that records invocation, then run a built-in automation that has no source command:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project" "$probe/bin"
cat > "$probe/bin/codex" <<'SH'
#!/bin/sh
printf 'executed:%s\n' "$*" >> "$FAKE_MARKER"
printf 'fake workflow agent\n'
SH
chmod +x "$probe/bin/codex"

(
  cd "$probe/project"
  PATH="$probe/bin:$PATH" FAKE_MARKER="$probe/marker" HOME="$probe/home" \
    POE_API_KEY=probe-key /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run github-workflows run update-dependencies --agent codex
)

cat "$probe/marker"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command exits successfully and reports `Ran automation "update-dependencies" with agent "codex" for 1 item.`
- The fake `codex` executable is invoked with the fully rendered automation prompt, proving that execution occurs without contacting an LLM or GitHub.

## Expected Behavior

With root `--dry-run`, running a GitHub automation must not launch its agent or execute arbitrary local agent binaries. It should preview the chosen automation, prompt, and agent only.

## Impact

- A preview can trigger real agent execution, API costs, or local command side effects.
- Users cannot safely inspect scheduled automation dispatch behavior.
- Workflow automation safety depends on a root dry-run option that is ignored for forwarded execution.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`, but forwarded Toolcraft flags do not include `--dry-run`. `packages/github-workflows/src/commands.ts` implements `run` by calling `spawn(agent, ...)` directly for an automation without a source command.

## Suspected Area

Root dry-run intent must be forwarded into GitHub workflow automation handlers, which need to bypass source and agent execution while previewing.
