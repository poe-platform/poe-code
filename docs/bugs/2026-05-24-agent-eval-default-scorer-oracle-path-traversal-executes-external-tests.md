# Agent Eval default scorer oracle path traversal executes external tests

## Summary

The default scorer joins `oracle.path` onto the eval directory without restricting traversal segments. An eval can set its oracle path to `../...` and cause ordinary Vitest scoring to execute test modules outside the eval directory.

## Reproduction

From the repository root, place an external passing Vitest file beside an eval directory and invoke the default scorer with a traversing oracle path:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/eval" "$probe/clone" "$probe/outside/oracle/tests"
cat > "$probe/outside/oracle/tests/external.test.ts" <<'EOF'
import { test, expect } from "vitest";
test("traversed external oracle", () => expect(true).toBe(true));
EOF

cat > "$probe/repro.mts" <<EOF
import { runScorer } from "file://$PWD/packages/agent-eval/src/run/scorer.ts";

const base = "$probe";
console.log(JSON.stringify(await runScorer({
  evalDir: \`\${base}/eval\`, cloneDir: \`\${base}/clone\`,
  evalDef: {
    id: "case", title: "case", rootDir: \`\${base}/eval\`,
    target: { repo: "local", ref: "main", planDest: "docs/plans/task.md" },
    scorer: undefined,
    oracle: { path: "../outside/oracle", solutionDest: "." },
    budget: { maxIterations: 1, maxTokens: 1, wallClockMs: 1000 },
    judge: { agent: "codex", model: "test", rubric: [] },
    weights: { tests: 1, judge: 0 },
    plan: { path: "plan.md", kind: "plan", body: "", frontmatter: {} }
  }
})));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/agent-eval/src/run/scorer.ts | sed -n '28,52p'
nl -ba packages/agent-eval/src/run/vitest-runner.ts | sed -n '34,94p'
nl -ba packages/agent-eval/src/schema.ts | sed -n '59,63p'
```

## Observed Behavior

Vitest executes the external test module and reports it as the scoring result:

```text
{"passed":1,"total":1,"cases":[{"name":"external.test.ts > traversed external oracle","passed":true,"durationMs":<duration>}]}
```

## Expected Behavior

`oracle.path` should be constrained to canonical oracle directories contained within the eval. A traversing value escaping the eval root should be rejected before any test runner launches.

## Impact

An eval configuration can execute arbitrary external test code and use its result in ordinary scoring without needing a symlink, expanding the code-execution boundary beyond the reviewed eval tree.
