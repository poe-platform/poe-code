# Agent Eval lint follows a symlinked definition file and validates external configuration

## Summary

`evalLint()` reads `<source>/<id>/eval.yaml` without rejecting a symbolic link at that file. A safe local eval ID can therefore cause lint to parse external target and budget configuration, emitting findings derived from a document outside the source root.

## Reproduction

From the repository root, create an otherwise local eval whose definition file points to external configuration that triggers deterministic lint warnings:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/source/case/oracle/tests" "$probe/source/case/oracle/solution" "$probe/outside"
cat > "$probe/source/case/plan.md" <<'EOF'
---
kind: plan
---
# Local plan
EOF
printf 'export const ok = true;\n' > "$probe/source/case/oracle/tests/default.test.ts"
printf 'export const ok = true;\n' > "$probe/source/case/oracle/solution/index.ts"
cat > "$probe/outside/eval.yaml" <<'EOF'
id: case
title: External eval
target:
  repo: external
  ref: main
oracle:
  path: oracle
budget:
  max_iterations: 1
  max_tokens: 100
  wall_clock_ms: 1
judge:
  agent: codex
  model: outside-model
  rubric:
    - completeness
weights:
  tests: 1
  judge: 0
EOF
ln -s "$probe/outside/eval.yaml" "$probe/source/case/eval.yaml"

cat > "$probe/repro.mts" <<EOF
import { evalLint } from "file://$PWD/packages/agent-eval/src/lint/lint.ts";

console.log(JSON.stringify(await evalLint({ sourceDir: "$probe/source", evalId: "case" })));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/source/case/eval.yaml"

nl -ba packages/agent-eval/src/lint/lint.ts | sed -n '27,44p;103,130p'
```

## Observed Behavior

Lint follows the symlink and emits warnings derived from the external definition while presenting the diagnostic path as local:

```text
{"evalId":"case","issues":[{"severity":"warning","code":"W003","message":"budget.wall_clock_ms is below 60000 and is likely too short.","path":"<probe>/source/case/eval.yaml"},{"severity":"warning","code":"W004","message":"target.ref \"main\" is not a full commit SHA; pin it to a commit SHA.","path":"<probe>/source/case/eval.yaml"}]}
<probe>/source/case/eval.yaml -> <probe>/outside/eval.yaml
```

## Expected Behavior

Lint should parse only canonical eval definition files contained in the configured source root. A symlinked `eval.yaml` escaping that root should be rejected before its configuration is validated.

## Impact

Linting an apparently local eval can load externally controlled target and execution-budget metadata, disclose validation results about external documents, and report those values as though they belonged to the reviewed local eval. This is distinct from normal eval loading because it affects lint-only validation workflows.
