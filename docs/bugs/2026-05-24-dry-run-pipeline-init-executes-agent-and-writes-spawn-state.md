# Dry-run pipeline init executes an agent and writes spawn state

## Summary

Running `pipeline init` with `--dry-run` still invokes the selected agent instead of previewing the generated request. Using a fake `codex` executable proves the command is launched, and the dry-run invocation writes spawn logs and runtime job state under the isolated home directory.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable source document and a fake `codex` command that records its invocation while returning successful JSON output:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/docs/plans" "$probe/bin"

cat > "$probe/project/docs/plans/source.md" <<'EOF'
# Source
EOF

cat > "$probe/bin/codex" <<EOF
#!/bin/sh
printf '%s\n' "\$*" > "$probe/called.txt"
printf '{"type":"thread.started","thread_id":"probe"}\n'
printf '{"type":"turn.completed","usage":{"input_tokens":0,"output_tokens":0}}\n'
exit 0
EOF
chmod +x "$probe/bin/codex"

(
  cd "$probe/project"
  HOME="$probe/home" POE_API_KEY=probe-key PATH="$probe/bin:$PATH" \
    npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes pipeline init \
    --agent codex --source docs/plans/source.md
)

cat "$probe/called.txt"
find "$probe/home/.poe-code" -type f -print
```

Replace `/path/to/poe-code` with the repository checkout path. The disposable API-key value only permits the command to reach the replaced local executable; it does not contact a real agent in this reproduction.

## Observed Behavior

- The fake `codex` executable runs and records an `exec` invocation containing the full pipeline-init generation prompt.
- The command reports `Completed 1/1` and `Pipeline init finished.` instead of showing a dry-run preview.
- Files are created under the isolated home, including `.poe-code/spawn-logs/*.jsonl` and `.poe-code/state/jobs/*.json`.

## Expected Behavior

With `--dry-run`, `pipeline init` must not execute an agent, create spawn logs or runtime job state, or allow generated edits to occur. It should render what source documents and agent prompt would be used.

## Impact

- Previewing pipeline initialization can execute arbitrary configured-agent behavior.
- Users can incur external agent activity and unintended source-document edits during simulation.
- Dry-run invocations leave execution artifacts and job state on disk.

## Supporting Evidence

The root CLI describes `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. The `pipeline init` handler in `src/cli/commands/pipeline.ts` resolves dry-run flags but calls `sdkRunPipelineInit` without a dry-run branch; `src/sdk/pipeline.ts` supplies a runner that invokes `sdkSpawn.autonomous` for each source.

## Suspected Area

`pipeline init` needs an explicit dry-run path before invoking the SDK initializer or any autonomous spawn infrastructure.
