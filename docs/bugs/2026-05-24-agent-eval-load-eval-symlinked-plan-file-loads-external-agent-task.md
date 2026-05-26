# Agent Eval loading follows a symlinked plan file and loads an external agent task

## Summary

The exported Agent Eval `loadEval()` API reads `<source>/<id>/plan.md` for a validated local eval id, but does not reject a symbolic link at that plan file. A locally registered eval can therefore supply external plan instructions as its executable task while its `eval.yaml` remains inside the configured source root.

## Reproduction

From the repository root, create a local eval definition with an externally linked plan document and load it through the package API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/source/case" "$probe/outside"
cat > "$probe/source/case/eval.yaml" <<'EOF'
id: case
title: Local eval
target:
  repo: local
  ref: main
oracle:
  path: oracle
budget:
  max_iterations: 1
  max_tokens: 100
  wall_clock_ms: 1000
judge:
  agent: codex
  model: openai/gpt-5
  rubric:
    - completeness
weights:
  tests: 1
  judge: 0
EOF
cat > "$probe/outside/plan.md" <<'EOF'
---
kind: plan
---
# External eval plan

External instructions
EOF
ln -s "$probe/outside/plan.md" "$probe/source/case/plan.md"

cat > "$probe/repro.mts" <<EOF
import { openSource } from "file://$PWD/packages/agent-eval/src/source/open.ts";
import { loadEval } from "file://$PWD/packages/agent-eval/src/source/registry.ts";

const source = await openSource("$probe/source");
const result = await loadEval(source, "case");
console.log(JSON.stringify({ id: result.id, kind: result.plan.kind, body: result.plan.body }));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/source/case/plan.md"

nl -ba packages/agent-eval/src/source/open.ts | sed -n '11,42p'
nl -ba packages/agent-eval/src/source/registry.ts | sed -n '40,80p'
```

## Observed Behavior

The loader accepts the local eval directory and returns plan content read through its external plan symlink:

```text
<probe>/source/case/plan.md -> <probe>/outside/plan.md
{"id":"case","kind":"plan","body":"# External eval plan\n\nExternal instructions\n"}
```

`loadEval()` validates the textual eval identifier and reads `eval.yaml` and `plan.md` formed beneath the local directory, but does not verify the canonical location of either input file before parsing the plan body.

## Expected Behavior

An eval definition should load executable plan content only from canonical files beneath its configured eval source directory. A symlinked `plan.md` escaping the source root should be rejected rather than interpreted as an eval task.

## Impact

A local eval registry entry can execute or assess external instructions not stored with the reviewed eval definition. This allows hidden task substitution at load time without requiring id traversal or a symlinked entire eval directory.
