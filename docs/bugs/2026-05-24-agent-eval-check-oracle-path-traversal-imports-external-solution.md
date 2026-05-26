# Agent Eval check oracle path traversal imports an external solution into the clone

## Summary

`evalCheck()` derives its oracle solution source from `path.join(evalDir, oracle.path, "solution")` without restricting traversal segments in `oracle.path`. An eval can therefore copy solution files from outside its directory into the check clone before scoring.

## Reproduction

From the repository root, create an eval whose oracle path traverses to an external sibling solution directory, then run `evalCheck()` with a harmless scorer:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/source/task" "$probe/source/outside/oracle/solution" "$probe/target"
printf 'read from external oracle solution\n' > "$probe/source/outside/oracle/solution/answer.txt"
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
title: Check oracle traversal
target: { repo: $probe/target, ref: main }
scorer:
  command: "printf '{\"passed\":1,\"total\":1}' > \"\$CLONE_DIR/score.json\""
  result_path: score.json
  timeout_ms: 5000
oracle:
  path: ../outside/oracle
  solution_dest: imported
budget: { max_iterations: 1, max_tokens: 1000, wall_clock_ms: 60000 }
judge: { agent: codex, model: test, rubric: [completeness] }
weights: { tests: 1, judge: 0 }
EOF
cat > "$probe/source/task/plan.md" <<'EOF'
---
kind: plan
---
# check
EOF

cat > "$probe/repro.mts" <<EOF
import { evalCheck } from "file://$PWD/packages/agent-eval/src/check/check.ts";

const result = await evalCheck({ sourceDir: "$probe/source", evalId: "task" });
console.log(result.cloneDir);
console.log(JSON.stringify(result.tests));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
find "$probe/source/runs/.check" -path '*/clone/imported/answer.txt' -print -exec cat {} \;

nl -ba packages/agent-eval/src/check/check.ts | sed -n '31,45p;79,105p'
nl -ba packages/agent-eval/src/schema.ts | sed -n '59,63p'
```

## Observed Behavior

The check succeeds and copies content from the external sibling oracle solution into the cloned target:

```text
<probe>/source/runs/.check/task/<timestamp>/clone
{"passed":1,"total":1,"cases":[]}
<probe>/source/runs/.check/task/<timestamp>/clone/imported/answer.txt contains: read from external oracle solution
```

## Expected Behavior

`oracle.path` should resolve only to canonical oracle directories contained within the eval directory. Traversing paths outside the eval should be rejected before solution files are copied or scoring begins.

## Impact

An eval can import arbitrary sibling solution content into a target clone and then score against it, disclosing external files and permitting hidden solution substitution in the check workflow.
