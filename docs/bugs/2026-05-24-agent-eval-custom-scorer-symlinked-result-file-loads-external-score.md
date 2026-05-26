# Agent Eval custom scorer follows a symlinked result file and loads an external score

## Summary

`runScorer()` reads the configured custom-scorer result path beneath the clone without rejecting a symbolic link at the file. A clone can therefore present an external JSON document as its scorer output and have externally controlled results accepted as the eval score.

## Reproduction

From the repository root, create a clone whose configured score file is a symlink to an external valid result, then run a no-op custom scorer:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/eval/oracle" "$probe/clone" "$probe/outside"
printf '%s\n' '{"passed":7,"total":9}' > "$probe/outside/score.json"
ln -s "$probe/outside/score.json" "$probe/clone/score.json"

cat > "$probe/repro.mts" <<EOF
import { runScorer } from "file://$PWD/packages/agent-eval/src/run/scorer.ts";

const base = "$probe";
const result = await runScorer({
  evalDir: \`\${base}/eval\`,
  cloneDir: \`\${base}/clone\`,
  evalDef: {
    id: "case",
    title: "case",
    rootDir: \`\${base}/eval\`,
    target: { repo: "local", ref: "main", planDest: "docs/plans/task.md" },
    scorer: { command: "true", cwd: "", resultPath: "score.json", timeoutMs: 1000 },
    oracle: { path: "oracle", solutionDest: "." },
    budget: { maxIterations: 1, maxTokens: 1, wallClockMs: 1000 },
    judge: { agent: "codex", model: "test", rubric: [] },
    weights: { tests: 1, judge: 0 },
    plan: { path: "plan.md", kind: "plan", body: "", frontmatter: {} }
  }
});
console.log(JSON.stringify(result));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/clone/score.json"
cat "$probe/outside/score.json"

nl -ba packages/agent-eval/src/run/scorer.ts | sed -n '56,81p;141,181p'
```

## Observed Behavior

The scorer command writes no result, but `runScorer()` follows the result symlink and accepts the external score document:

```text
{"passed":7,"total":9,"cases":[]}
<probe>/clone/score.json -> <probe>/outside/score.json
{"passed":7,"total":9}
```

## Expected Behavior

Custom scorer results should be read only from canonical files contained in the evaluated clone and produced there by the scoring flow. A configured result file symlink escaping the clone should be rejected rather than parsed as a valid score.

## Impact

Test outcomes can be supplied by content outside the evaluated clone, allowing externally controlled score injection or disclosure of external result JSON. This compromises the integrity of eval correctness results independently of post-run result loading.
