# Agent Eval custom scorer follows a symlinked working directory and executes outside the clone

## Summary

`runScorer()` executes a custom scorer in `path.join(cloneDir, scorer.cwd)` without rejecting a symbolic link in that path. A scorer configured with a local-looking working directory can therefore run its command in an external directory outside the evaluated clone.

## Reproduction

From the repository root, create a clone with a symlinked scorer working directory, then invoke a harmless custom scorer that writes its current directory and a valid score result:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/eval/oracle" "$probe/clone" "$probe/outside/cwd"
ln -s "$probe/outside/cwd" "$probe/clone/linked"

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
    scorer: {
      command: 'pwd > scorer-cwd.txt; printf \'{"passed":1,"total":1}\' > "$CLONE_DIR/score.json"',
      cwd: "linked",
      resultPath: "score.json",
      timeoutMs: 1000
    },
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
ls -l "$probe/clone/linked"
cat "$probe/outside/cwd/scorer-cwd.txt"

nl -ba packages/agent-eval/src/run/scorer.ts | sed -n '28,80p'
```

## Observed Behavior

The scorer succeeds while its command executes in the external symlink target and writes its marker outside the clone:

```text
{"passed":1,"total":1,"cases":[]}
<probe>/clone/linked -> <probe>/outside/cwd
<probe>/outside/cwd/scorer-cwd.txt contains: <probe>/outside/cwd
```

`runCustomScorer()` constructs `cwd` from the clone path and configured relative value, then launches the command without canonical containment validation.

## Expected Behavior

Custom scorer commands should execute only in canonical directories contained within the evaluated clone. A scorer working directory that resolves through a symlink outside the clone should be rejected before any command launches.

## Impact

Running tests for an eval can execute scorer shell behavior outside the isolated target clone, permitting externally located writes or other side effects from a local-looking scorer path. This undermines the clone boundary relied upon for evaluation execution.
