# Agent Eval run plan destination path traversal writes the task outside the clone

## Summary

`runEval()` copies the eval plan to `path.join(cloneDir, target.plan_dest)` without requiring the configured destination to remain inside the cloned target. An eval definition can use `../` segments in `plan_dest` to write its task document outside the clone during a run.

## Reproduction

From the repository root, create a disposable local target and eval whose plan destination traverses above the run clone, then execute the run with a harmless fake agent and scorer:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/source/task/oracle" "$probe/target" "$probe/out" "$probe/bin"
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
title: Escaped plan destination
target:
  repo: $probe/target
  ref: main
  plan_dest: ../../../escaped-plan.md
scorer:
  command: "printf '{\"passed\":1,\"total\":1}' > \"\$CLONE_DIR/score.json\""
  result_path: score.json
  timeout_ms: 5000
oracle:
  path: oracle
budget:
  max_iterations: 1
  max_tokens: 1000
  wall_clock_ms: 60000
judge:
  agent: codex
  model: test
  rubric: [completeness]
weights:
  tests: 1
  judge: 0
EOF
cat > "$probe/source/task/plan.md" <<'EOF'
---
kind: plan
---
# Escaped plan content
EOF
cat > "$probe/bin/codex" <<'EOF'
#!/bin/sh
cat >/dev/null || true
exit 0
EOF
chmod +x "$probe/bin/codex"

cat > "$probe/repro.mts" <<EOF
import { runEval } from "file://$PWD/packages/agent-eval/src/run/run.ts";

const result = await runEval({
  sourceDir: "$probe/source",
  evalId: "task",
  agent: "codex",
  model: "test",
  outDir: "$probe/out",
  judge: "off",
  verifyOracle: false
});
console.log(result.runId);
EOF

PATH="$probe/bin:$PATH" "$repo/node_modules/.bin/tsx" "$probe/repro.mts"
find "$probe" -name escaped-plan.md -print -exec cat {} \;

nl -ba packages/agent-eval/src/run/run.ts | sed -n '99,110p'
nl -ba packages/agent-eval/src/schema.ts | sed -n '45,61p'
```

## Observed Behavior

The run succeeds and copies the plan beyond its cloned target into the probe root:

```text
<run-id>
<probe>/escaped-plan.md
---
kind: plan
---
# Escaped plan content
```

The configured path is accepted as an arbitrary string, and joining `<run>/clone` with `../../../escaped-plan.md` resolves outside both the clone and its run directory.

## Expected Behavior

`target.plan_dest` should identify only a relative destination canonically contained within the cloned target. Destinations containing traversal segments or otherwise escaping the clone should be rejected before any copy occurs.

## Impact

Running an eval can write its plan content outside the isolated clone and overwrite files in broader output or adjacent locations selected by the definition. The executed agent also receives a plan path outside the target repository boundary.
