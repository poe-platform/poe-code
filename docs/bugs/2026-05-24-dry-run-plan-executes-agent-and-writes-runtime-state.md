# Dry-run plan executes an agent and writes runtime state

## Summary

Running `plan` with a question and `--dry-run` still launches the selected planning agent. Replacing `codex` with a disposable recorder proves the full planning prompt is executed, and the command writes detached runtime-job state under the isolated home directory.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable fake `codex` executable that records its command-line prompt:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project" "$probe/bin"

cat > "$probe/bin/codex" <<EOF
#!/bin/sh
printf '%s\n' "\$*" > "$probe/called.txt"
exit 0
EOF
chmod +x "$probe/bin/codex"

(
  cd "$probe/project"
  HOME="$probe/home" POE_API_KEY=probe-key PATH="$probe/bin:$PATH" \
    npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes \
    plan 'write a small plan' --agent codex
)

cat "$probe/called.txt"
find "$probe/home/.poe-code" -type f -print
```

Replace `/path/to/poe-code` with the repository checkout path. The disposable API-key value only lets the CLI reach the replacement local executable in this reproduction.

## Observed Behavior

- The fake `codex` executable runs and receives the complete `/plan` skill prompt plus `User request: write a small plan`.
- The invocation is passed interactive execution flags, including `-a never -s danger-full-access`.
- Runtime state is written under the isolated home at `.poe-code/state/jobs/<id>.json`.

## Expected Behavior

With `--dry-run`, `plan` must not launch an agent, execute plan-generation prompts, or create runtime execution state. It should only preview the agent and prompt it would use.

## Impact

- Previewing a plan session can execute arbitrary agent behavior and create plan files when a real agent is configured.
- Users may incur external agent usage or modify their worktree during a documented no-write simulation.
- Dry-run planning leaves runtime state artifacts behind.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/plan.ts`, the question-bearing `plan` action resolves flags but calls `runPlanSession` without a dry-run check; that function invokes `sdkSpawn` in interactive mode.

## Suspected Area

Plan session creation needs a dry-run preview path before constructing or launching any interactive agent execution.
