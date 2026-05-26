# Agent Eval result loading follows symlinked result and trace files to read external content

## Summary

The exported `loadRunResult()` API reads `result.json` and optional `trace.json` below an otherwise local eval run directory, but does not reject symbolic links at those individual file paths. A local-looking run can therefore return external result data and external trace summaries without symlinking its entire run directory.

## Reproduction

From the repository root, create a local run directory whose expected result and trace files link to external JSON documents, then load the run through the public package API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/runs/run-safe" "$probe/outside"
cat > "$probe/outside/result.json" <<'EOF'
{"runId":"run-safe","evalId":"case","agent":"codex","model":"m","verdict":"pass","score":1,"durationMs":1,"metrics":[]}
EOF
cat > "$probe/outside/trace.json" <<'EOF'
{"events":[{"type":"tool"},{"type":"error"}]}
EOF
ln -s "$probe/outside/result.json" "$probe/runs/run-safe/result.json"
ln -s "$probe/outside/trace.json" "$probe/runs/run-safe/trace.json"

cat > "$probe/repro.mts" <<EOF
import { loadRunResult } from "file://$PWD/packages/agent-eval/src/index.ts";
console.log(JSON.stringify(await loadRunResult("run-safe", "$probe/runs")));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/runs/run-safe/result.json" "$probe/runs/run-safe/trace.json"

nl -ba packages/agent-eval/src/report/load.ts | sed -n '18,46p;174,198p;201,213p'
```

## Observed Behavior

The loader validates the safe textual run id but follows both local file links and returns external result and trace data as the local run:

```text
<probe>/runs/run-safe/result.json -> <probe>/outside/result.json
<probe>/runs/run-safe/trace.json -> <probe>/outside/trace.json
{"runId":"run-safe","evalId":"case","agent":"codex","model":"m","verdict":"pass","score":1,"durationMs":1,"metrics":[],"trace":{"available":true,"eventCount":2,"toolEventCount":1,"errorEventCount":1}}
```

`loadRunResult()` reads the direct result path after only validating the textual identifier. `enrichRunResult()` independently reads the neighboring trace file, and neither read verifies canonical containment beneath `outDir`.

## Expected Behavior

Eval run loading should read result and trace documents only from canonical files beneath the selected output directory and run directory. Symlinked result or trace files escaping those roots should be rejected.

## Impact

An otherwise local run directory can disclose or present external JSON content as evaluation results and trace statistics. This bypass is distinct from replacing the whole run directory with a symlink and may undermine report integrity even if directory-level symlinks are blocked.
