# Dry-run superintendent run executes full-loop agent

## Summary

Running the full `superintendent run` loop with the root `--dry-run` option still launches the configured builder agent.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a fake `codex` executable on `PATH`

## Reproduction

From the repository root, create a disposable superintendent plan and a fake `codex` executable that records invocation, then fails immediately to keep the loop bounded:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/docs/plans" "$probe/bin"
cat > "$probe/bin/codex" <<'SH'
#!/bin/sh
printf 'executed:%s\n' "$*" >> "$FAKE_MARKER"
printf 'builder fake failure\n' >&2
exit 9
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
superintendent:
  agent: codex
  prompt: |
    Review {{builder.summary}}
owner:
  agent: codex
  prompt: |
    Review {{superintendent.summary}}
status:
  state: in_progress
  round: 0
  review_turn: 0
---
# Plan

## Task Board

- [ ] Probe task
DOC

(
  cd "$probe/project"
  PATH="$probe/bin:$PATH" FAKE_MARKER="$probe/agent-marker" HOME="$probe/home" \
    /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes superintendent run \
    docs/plans/probe.md --agent codex --no-tui
)

cat "$probe/agent-marker"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command invokes the fake `codex` binary as the loop builder and propagates its failure output.
- The marker records an autonomous agent launch even though root `--dry-run` was supplied.
- The deliberately failing fake agent keeps the reproduction bounded before later loop phases can execute.

## Expected Behavior

With root `--dry-run`, the full superintendent loop must not launch builder, superintendent, inspector, or owner agents. It should preview the selected plan, roles, and sequence only.

## Impact

- A preview of an autonomous loop can run arbitrary agent binaries or incur real LLM/API costs.
- The full-loop command exposes a higher-risk execution path than individual role commands because successful agents can trigger multiple iterative stages.
- Users cannot safely inspect planned autonomous execution before starting it.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`, but forwarded Toolcraft flags do not include `--dry-run`. `packages/superintendent/src/commands/run.ts` passes execution into `runLoop`, which dispatches the configured agents through the runtime without any preview guard.

## Suspected Area

Forwarded superintendent commands need root dry-run propagation and full-loop short-circuiting before any role runner executes.
