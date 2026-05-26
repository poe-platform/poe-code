# Agent Eval custom scorer exposes a symlinked oracle directory for writes outside the source

## Summary

`runScorer()` supplies a custom scorer with `ORACLE_DIR` built from `<eval>/oracle` without rejecting a symbolic link at that directory. A local eval can therefore cause its scorer command to write through `ORACLE_DIR` into an external filesystem location outside the eval source.

## Reproduction

From the repository root, create an eval whose oracle directory points outside its root, then run a harmless custom scorer that writes a marker through `ORACLE_DIR` and a valid score into the clone:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/eval" "$probe/clone" "$probe/outside/oracle"
ln -s "$probe/outside/oracle" "$probe/eval/oracle"

cat > "$probe/repro.mts" <<EOF
import { runScorer } from "file://$PWD/packages/agent-eval/src/run/scorer.ts";

const base = "$probe";
console.log(JSON.stringify(await runScorer({
  evalDir: \`\${base}/eval\`,
  cloneDir: \`\${base}/clone\`,
  evalDef: {
    id: "case",
    title: "case",
    rootDir: \`\${base}/eval\`,
    target: { repo: "local", ref: "main", planDest: "docs/plans/task.md" },
    scorer: {
      command: 'pwd > "$ORACLE_DIR/scorer-oracle.txt"; printf \'{"passed":1,"total":1}\' > "$CLONE_DIR/score.json"',
      cwd: "",
      resultPath: "score.json",
      timeoutMs: 1000
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
ls -l "$probe/eval/oracle"
cat "$probe/outside/oracle/scorer-oracle.txt"

nl -ba packages/agent-eval/src/run/scorer.ts | sed -n '28,80p;123,140p'
```

## Observed Behavior

The score succeeds and the marker is created under the external oracle target through the supplied environment variable:

```text
{"passed":1,"total":1,"cases":[]}
<probe>/eval/oracle -> <probe>/outside/oracle
<probe>/outside/oracle/scorer-oracle.txt contains: <probe>/clone
```

`runScorer()` forms the oracle path textually, then injects it into `ORACLE_DIR`; shell file operations follow the unresolved symlink outside the eval root.

## Expected Behavior

Custom scoring should expose only canonical oracle directories contained in the eval root. A symlinked oracle path escaping that root should be rejected before any scorer command receives or uses it.

## Impact

A scorer launched for a local eval can read or write external oracle locations while the operation appears scoped to the eval directory. This is distinct from oracle verification because it occurs in the ordinary custom scoring path used to produce test outcomes.
