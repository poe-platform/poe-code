# Agent Eval custom scorer working directory path traversal executes outside the clone

## Summary

`runScorer()` joins the custom scorer's `cwd` string onto the clone directory without restricting traversal segments. An eval can set `scorer.cwd` to `../...` and execute its scoring command in a directory outside the cloned target.

## Reproduction

From the repository root, invoke a custom scorer with a traversing working-directory configuration and a harmless marker command:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/eval" "$probe/clone" "$probe/outside/cwd"

cat > "$probe/repro.mts" <<EOF
import { runScorer } from "file://$PWD/packages/agent-eval/src/run/scorer.ts";

const base = "$probe";
console.log(JSON.stringify(await runScorer({
  evalDir: \`\${base}/eval\`,
  cloneDir: \`\${base}/clone\`,
  evalDef: {
    id: "case", title: "case", rootDir: \`\${base}/eval\`,
    target: { repo: "local", ref: "main", planDest: "docs/plans/task.md" },
    scorer: {
      command: 'pwd > traversal-cwd.txt; printf \'{"passed":1,"total":1}\' > "$CLONE_DIR/score.json"',
      cwd: "../outside/cwd", resultPath: "score.json", timeoutMs: 1000
    },
    oracle: { path: "oracle", solutionDest: "." },
    budget: { maxIterations: 1, maxTokens: 1, wallClockMs: 1000 },
    judge: { agent: "codex", model: "test", rubric: [] },
    weights: { tests: 1, judge: 0 },
    plan: { path: "plan.md", kind: "plan", body: "", frontmatter: {} }
  }
})));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
cat "$probe/outside/cwd/traversal-cwd.txt"

nl -ba packages/agent-eval/src/run/scorer.ts | sed -n '56,80p'
nl -ba packages/agent-eval/src/schema.ts | sed -n '51,58p'
```

## Observed Behavior

The scorer succeeds and executes in the external directory reached by `../outside/cwd`:

```text
{"passed":1,"total":1,"cases":[]}
<probe>/outside/cwd/traversal-cwd.txt contains: <probe>/outside/cwd
```

## Expected Behavior

`scorer.cwd` should be restricted to canonical locations contained within the evaluated clone. Traversing paths escaping the clone should be rejected before process execution.

## Impact

An eval configuration can directly select external working directories for scorer shell execution, enabling side effects outside the cloned target without requiring any filesystem symlink setup.
