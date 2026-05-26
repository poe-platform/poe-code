# Agent Eval check follows a symlinked solution destination and writes outside the clone

## Summary

`evalCheck()` verifies that `oracle.solution_dest` is textually beneath the cloned target, but does not reject symlinked directories already present inside that clone. A target repository containing a symlink at the selected destination can therefore redirect copied oracle solution files outside the clone.

## Reproduction

From the repository root, create a local target repository with a committed `patched` symlink and an eval that copies its solution into `patched/copied` during `evalCheck()`:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/source/task/oracle/solution" "$probe/target" "$probe/outside"
printf 'external write through clone link\n' > "$probe/source/task/oracle/solution/answer.txt"
(
  cd "$probe/target"
  git init -q -b main
  git config user.email probe@example.invalid
  git config user.name Probe
  ln -s "$probe/outside" patched
  git add patched
  git commit -q -m init
)
cat > "$probe/source/.poe-code-eval.json" <<'EOF'
{"out":"artifacts"}
EOF
cat > "$probe/source/task/eval.yaml" <<EOF
id: task
title: Check symlink destination
target:
  repo: $probe/target
  ref: main
scorer:
  command: "printf '{\"passed\":1,\"total\":1}' > \"\$CLONE_DIR/score.json\""
  result_path: score.json
  timeout_ms: 5000
oracle:
  path: oracle
  solution_dest: patched/copied
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
cat "$probe/outside/copied/answer.txt"

nl -ba packages/agent-eval/src/check/check.ts | sed -n '31,45p;79,105p'
```

## Observed Behavior

The check succeeds, but its copied oracle solution appears in the external target of the cloned repository's symlink:

```text
<probe>/source/artifacts/.check/task/<timestamp>/clone
{"passed":1,"total":1,"cases":[]}
<probe>/outside/copied/answer.txt contains: external write through clone link
```

The lexical `path.relative()` check accepts `patched/copied`, while `mkdir()` and `cp()` follow the cloned `patched -> <probe>/outside` symlink during the write.

## Expected Behavior

Solution copying should target only canonical destinations contained within the cloned repository. A contained textual path that resolves through a symlink outside the clone should be rejected before writing.

## Impact

Running `eval check` against a target repository can write oracle solution content outside the disposable clone, allowing modifications to arbitrary external directories reachable through committed symlinks.
