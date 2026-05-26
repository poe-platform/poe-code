# Agent Eval default scorer follows a symlinked oracle directory and executes external tests

## Summary

The default Vitest scorer resolves its test directory as `<eval>/oracle/tests` without rejecting a symlinked `oracle` directory. A local eval can therefore execute test modules located outside its source root during normal scoring.

## Reproduction

From the repository root, create an eval with a symlinked oracle directory whose external target contains a passing Vitest module, then invoke the default scorer:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/eval" "$probe/clone" "$probe/outside/oracle/tests"
ln -s "$probe/outside/oracle" "$probe/eval/oracle"
cat > "$probe/outside/oracle/tests/external.test.ts" <<'EOF'
import { test, expect } from "vitest";

test("external test executes", () => {
  expect(process.env.ORACLE_DIR).toContain("oracle");
});
EOF

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
    scorer: undefined,
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

nl -ba packages/agent-eval/src/run/scorer.ts | sed -n '28,52p'
nl -ba packages/agent-eval/src/run/vitest-runner.ts | sed -n '34,94p'
```

## Observed Behavior

The default scorer executes the external test file and accepts its result even though the local eval contains no in-root oracle tests:

```text
{"passed":1,"total":1,"cases":[{"name":"external.test.ts > external test executes","passed":true,"durationMs":<duration>}]}
<probe>/eval/oracle -> <probe>/outside/oracle
```

`runScorer()` builds `testsDir` from the symlinked oracle path, and `runVitest()` uses that path as both its root and working directory without canonical containment validation.

## Expected Behavior

Default scoring should execute only canonical test modules contained in the eval's oracle tree. A symlinked oracle directory escaping the eval root should be rejected before Vitest launches.

## Impact

Running normal evaluation tests can execute arbitrary TypeScript test code outside the reviewed eval tree, permitting external side effects and externally supplied pass/fail outcomes. This is distinct from the verification command flow and from custom scorer behavior.
