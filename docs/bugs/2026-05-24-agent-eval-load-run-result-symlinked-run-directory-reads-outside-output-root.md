# Agent Eval result loading follows a symlinked run directory outside the output root

## Summary

The exported `loadRunResult()` API validates the `runId` text but then reads `<outDir>/<runId>/result.json` and `trace.json` without verifying the canonical run-directory location. If a valid run directory entry is a symlink to an external directory, the API reads and returns externally stored result and trace data as an eval run beneath the configured output root.

## Reproduction

From the repository root, create a disposable runs directory with a normal-looking symlinked run id and load it through the public package API:

```sh
repo=$PWD
probe=$(mktemp -d)
out="$probe/runs"
outside="$probe/outside"
mkdir -p "$out" "$outside"
ln -s "$outside" "$out/run-safe"

cat > "$outside/result.json" <<'EOF'
{"runId":"run-safe","eval":"outside-eval","agent":"agent","model":"model","verdict":"pass","iterations":1,"durationMs":1,"usage":{"inputTokens":0,"outputTokens":0},"tests":{"passed":1,"failed":0},"correctness":1}
EOF
cat > "$outside/trace.json" <<'EOF'
{"events":[{"type":"tool"},{"type":"error"}]}
EOF

cat > "$probe/repro.mts" <<EOF
import { loadRunResult } from "file://$PWD/packages/agent-eval/src/index.ts";

console.log(JSON.stringify(await loadRunResult("run-safe", "$out")));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/agent-eval/src/report/load.ts | sed -n '18,45p;173,214p'
```

## Observed Behavior

The public result loader follows `runs/run-safe -> outside` and returns the external result together with a trace summary derived from the external trace:

```text
{"runId":"run-safe","eval":"outside-eval",...,"trace":{"available":true,"eventCount":2,"toolEventCount":1,"errorEventCount":1}}
```

The requested run id passes `assertValidRunId()` and contains no traversal or separators. The disclosure occurs because the direct result lookup uses the symlinked run directory without canonical containment validation.

## Expected Behavior

Eval result loading should read only run artifacts that resolve beneath the canonical configured output directory. A run directory symlink escaping `outDir` should be rejected before result or trace files are read.

## Impact

A crafted result-store symlink can cause consumers of the public Agent Eval reporting API to disclose arbitrary external JSON result and trace files accessible to the process, while presenting them as normal run artifacts under the requested eval output root.
