# Agent Eval matrix agent path traversal writes run and aggregate artifacts outside the matrix directory

## Summary

`runMatrix()` incorporates the configured agent string directly into both run IDs and aggregate filenames without sanitizing path separators or traversal segments. Supplying an agent value containing `../../../` causes evaluation artifacts to be written outside the timestamped matrix directory.

## Reproduction

From the repository root, create a disposable local eval and run a single matrix cell using a traversing agent identifier. The missing agent executable is harmless: run artifacts and aggregation are still produced around the failed dispatch.

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/source/task/oracle" "$probe/target" "$probe/out"
(
  cd "$probe/target"
  git init -q -b main
  git config user.email probe@example.invalid
  git config user.name Probe
  printf 'target\n' > README.md
  git add README.md
  git commit -q -m init
)
cat > "$probe/source/task/eval.yaml" <<EOF
id: task
title: Matrix agent traversal
target: { repo: $probe/target, ref: main }
scorer:
  command: "printf '{\"passed\":1,\"total\":1}' > \"\$CLONE_DIR/score.json\""
  result_path: score.json
  timeout_ms: 5000
oracle: { path: oracle }
budget: { max_iterations: 1, max_tokens: 1000, wall_clock_ms: 60000 }
judge: { agent: codex, model: test, rubric: [completeness] }
weights: { tests: 1, judge: 0 }
EOF
cat > "$probe/source/task/plan.md" <<'EOF'
---
kind: plan
---
# matrix
EOF

cat > "$probe/repro.mts" <<EOF
import { runMatrix } from "file://$PWD/packages/agent-eval/src/run/matrix.ts";

for await (const result of runMatrix({
  sourceDir: "$probe/source",
  evalIds: ["task"],
  agents: ["../../../escaped"],
  models: ["model"],
  repeats: 1,
  outDir: "$probe/out",
  verifyOracle: false,
  judge: "off"
})) {
  console.log(result.runId);
}
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts" || true
find "$probe/out" -maxdepth 3 \( -name '*escaped*' -o -name 'aggregate-*' \) -print | sort
find "$probe/out" -maxdepth 2 -type f -name result.json -print

nl -ba packages/agent-eval/src/run/run.ts | sed -n '290,305p'
nl -ba packages/agent-eval/src/run/matrix.ts | sed -n '22,62p;81,108p;157,167p;185,201p'
```

## Observed Behavior

The run identifier contains the traversal value, and both the run directory and aggregate JSON appear at the top of the configured output root instead of within the generated matrix directory:

```text
<timestamp>-task-../../../escaped-model-r0
<probe>/out/escaped-model-r0
<probe>/out/escaped-model.json
<probe>/out/escaped-model-r0/result.json
```

`model` is sanitized for output naming, but `agent` is concatenated unchanged into the filesystem paths.

## Expected Behavior

Agent and model identifiers used in output filenames should be encoded as single safe path components, and generated run or aggregate files should remain canonically within their timestamped matrix directory.

## Impact

A caller selecting an agent string can escape the matrix output namespace and create or overwrite evaluation run and aggregate artifacts in broader configured output locations. Reports subsequently enumerate misleading or attacker-selected filesystem layout.
