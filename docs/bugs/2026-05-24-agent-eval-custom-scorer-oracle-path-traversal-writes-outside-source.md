# Agent Eval custom scorer oracle path traversal writes outside the eval source

## Summary

The custom scorer receives `ORACLE_DIR` derived from `oracle.path` without restricting traversal segments. An eval can set `oracle.path` to an external relative path and have its scorer command write through that environment variable outside the eval directory.

## Reproduction

From the repository root, configure a custom scorer with a traversing oracle path and a harmless marker write through `ORACLE_DIR`:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/eval" "$probe/clone" "$probe/outside/oracle"

cat > "$probe/repro.mts" <<EOF
import { runScorer } from "file://$PWD/packages/agent-eval/src/run/scorer.ts";

const base = "$probe";
console.log(JSON.stringify(await runScorer({
  evalDir: \`\${base}/eval\`, cloneDir: \`\${base}/clone\`,
  evalDef: {
    id: "case", title: "case", rootDir: \`\${base}/eval\`,
    target: { repo: "local", ref: "main", planDest: "docs/plans/task.md" },
    scorer: {
      command: 'pwd > "$ORACLE_DIR/path-traversal-marker.txt"; printf \'{"passed":1,"total":1}\' > "$CLONE_DIR/score.json"',
      cwd: "", resultPath: "score.json", timeoutMs: 1000
    },
    oracle: { path: "../outside/oracle", solutionDest: "." },
    budget: { maxIterations: 1, maxTokens: 1, wallClockMs: 1000 },
    judge: { agent: "codex", model: "test", rubric: [] },
    weights: { tests: 1, judge: 0 },
    plan: { path: "plan.md", kind: "plan", body: "", frontmatter: {} }
  }
})));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
cat "$probe/outside/oracle/path-traversal-marker.txt"

nl -ba packages/agent-eval/src/run/scorer.ts | sed -n '28,80p;144,154p'
nl -ba packages/agent-eval/src/schema.ts | sed -n '59,63p'
```

## Observed Behavior

The score succeeds and the marker is written into the externally selected oracle location:

```text
{"passed":1,"total":1,"cases":[]}
<probe>/outside/oracle/path-traversal-marker.txt contains: <probe>/clone
```

## Expected Behavior

`oracle.path` should be constrained to canonical directories contained in the eval source before it is exposed to a custom scorer. Traversing paths should be rejected before command execution.

## Impact

An eval configuration can provide scorer commands with read/write access to externally selected oracle locations outside the eval root without relying on symlinks.
