# Dry-run superintendent agent commands execute agents

## Summary

Running `superintendent builder run` or `superintendent inspector run` with the root `--dry-run` option still executes the configured agent command.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a fake `codex` binary on `PATH`

## Reproduction

From the repository root, create a disposable superintendent document and a fake `codex` executable that records invocation:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/docs/plans" "$probe/bin"
cat > "$probe/bin/codex" <<'SH'
#!/bin/sh
printf 'executed:%s\n' "$*" >> "$FAKE_MARKER"
printf 'fake agent output\n'
SH
chmod +x "$probe/bin/codex"
cat > "$probe/project/docs/plans/probe.md" <<'DOC'
---
kind: superintendent
version: 1
builder:
  agent: codex
  prompt: |
    Build {{plan.path}}
inspectors:
  code-quality:
    agent: codex
    prompt: |
      Inspect {{plan.path}}
superintendent:
  agent: codex
  prompt: |
    Review {{builder.summary}}
owner:
  agent: codex
  prompt: |
    Review {{superintendent.summary}}
status:
  state: review
  round: 2
  review_turn: 3
---
# Plan
DOC

(
  cd "$probe/project"
  PATH="$probe/bin:$PATH" FAKE_MARKER="$probe/marker" HOME="$probe/home" \
    /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run superintendent builder run docs/plans/probe.md
)

cat "$probe/marker"
```

Replace `/path/to/poe-code` with the repository checkout path. Running `--dry-run superintendent inspector run docs/plans/probe.md code-quality` with the same fake executable also writes an execution marker.

## Observed Behavior

- `superintendent builder run` invokes the fake `codex` binary and reports `Builder run completed.` using its output.
- `superintendent inspector run` invokes the fake `codex` binary and reports `Completed 1 inspector run.` using its output.
- The fake-agent marker proves execution occurred; no actual LLM or network invocation is required to reproduce.

## Expected Behavior

With root `--dry-run`, superintendent agent commands must not launch configured agents or execute arbitrary agent binaries. They should report what role and prompt would run without execution.

## Impact

- A preview can invoke real agents, incur API cost, or run arbitrary local binaries.
- Users cannot safely inspect superintendent prompts or role dispatch behavior under dry-run.
- The root safety contract is ineffective for forwarded agent-bearing workflow commands.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`, but its forwarded Toolcraft flags exclude `--dry-run`. `packages/superintendent/src/commands/builder-group.ts` and `packages/superintendent/src/commands/inspector-group.ts` invoke their runtime runners directly, and `packages/superintendent/src/runtime/agent-runner.ts` executes the agent command without preview handling.

## Suspected Area

Root execution flags need propagation to forwarded Toolcraft commands, and superintendent role runners need dry-run short-circuits before agent execution.
