# Agent Eval custom scorer result path traversal loads an external score

## Summary

`runScorer()` joins `scorer.result_path` onto the clone directory without restricting traversal segments. A custom scorer can therefore claim a result file outside the cloned target and have external score JSON accepted as the run outcome.

## Reproduction

From the repository root, place a valid score outside the clone and configure a no-op scorer to load it through a traversing result path:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/eval" "$probe/clone" "$probe/outside"
printf '%s\n' '{"passed":5,"total":6}' > "$probe/outside/result.json"

cat > "$probe/repro.mts" <<EOF
import { runScorer } from "file://$PWD/packages/agent-eval/src/run/scorer.ts";

const base = "$probe";
console.log(JSON.stringify(await runScorer({
  evalDir: \`\${base}/eval\`, cloneDir: \`\${base}/clone\`,
  evalDef: {
    id: "case", title: "case", rootDir: \`\${base}/eval\`,
    target: { repo: "local", ref: "main", planDest: "docs/plans/task.md" },
    scorer: { command: "true", cwd: "", resultPath: "../outside/result.json", timeoutMs: 1000 },
    oracle: { path: "oracle", solutionDest: "." },
    budget: { maxIterations: 1, maxTokens: 1, wallClockMs: 1000 },
    judge: { agent: "codex", model: "test", rubric: [] },
    weights: { tests: 1, judge: 0 },
    plan: { path: "plan.md", kind: "plan", body: "", frontmatter: {} }
  }
})));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
cat "$probe/outside/result.json"

nl -ba packages/agent-eval/src/run/scorer.ts | sed -n '56,81p;159,181p'
nl -ba packages/agent-eval/src/schema.ts | sed -n '51,58p'
```

## Observed Behavior

The no-op scorer succeeds by loading score data located outside the clone:

```text
{"passed":5,"total":6,"cases":[]}
{"passed":5,"total":6}
```

## Expected Behavior

`scorer.result_path` should identify only canonical result files contained inside the evaluated clone. Traversal paths escaping the clone should be rejected before file reads.

## Impact

An eval can inject externally stored pass/fail results into scoring without requiring a symlink or a scorer-produced result, undermining the integrity of evaluation outcomes.
