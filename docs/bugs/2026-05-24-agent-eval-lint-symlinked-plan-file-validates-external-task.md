# Agent Eval lint follows a symlinked plan file and validates an external task document

## Summary

`evalLint()` reads `<source>/<id>/plan.md` without rejecting a symbolic link at that file. A safe, first-level local eval ID can therefore cause lint to parse and report issues from an external plan document outside the eval source root.

## Reproduction

From the repository root, create a valid local eval with only `plan.md` replaced by a symlink to an external plan containing an invalid frontmatter kind:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/source/case/oracle/tests" "$probe/source/case/oracle/solution" "$probe/outside"
cat > "$probe/source/case/eval.yaml" <<'EOF'
id: case
title: Local eval
target:
  repo: local
  ref: "1234567890123456789012345678901234567890"
oracle:
  path: oracle
budget:
  max_iterations: 1
  max_tokens: 100
  wall_clock_ms: 60000
judge:
  agent: codex
  model: openai/gpt-5
  rubric:
    - completeness
weights:
  tests: 1
  judge: 0
EOF
printf 'export const ok = true;\n' > "$probe/source/case/oracle/tests/default.test.ts"
printf 'export const ok = true;\n' > "$probe/source/case/oracle/solution/index.ts"
cat > "$probe/outside/plan.md" <<'EOF'
---
kind: external-invalid-kind
---
# External plan
EOF
ln -s "$probe/outside/plan.md" "$probe/source/case/plan.md"

cat > "$probe/repro.mts" <<EOF
import { evalLint } from "file://$PWD/packages/agent-eval/src/lint/lint.ts";

console.log(JSON.stringify(await evalLint({ sourceDir: "$probe/source", evalId: "case" })));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/source/case/plan.md"

nl -ba packages/agent-eval/src/lint/lint.ts | sed -n '27,44p;132,154p'
```

## Observed Behavior

Lint reports the invalid kind read from the external symlink target while presenting the issue path as the local eval's `plan.md`:

```text
{"evalId":"case","issues":[{"severity":"error","code":"E003","message":"plan.md frontmatter kind must be one of: plan, pipeline, superintendent, experiment.","path":"<probe>/source/case/plan.md"}]}
<probe>/source/case/plan.md -> <probe>/outside/plan.md
```

## Expected Behavior

Lint should validate only canonical plan documents contained within the configured eval source. A `plan.md` symlink escaping the source root should be rejected before its content is read or validated.

## Impact

Linting an apparently local eval can disclose validation outcomes for arbitrary external plan content and misattribute those findings to a local path. This is distinct from `loadEval()` because it affects the dedicated lint command and its diagnostics surface.
