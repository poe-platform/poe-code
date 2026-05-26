# Agent Eval oracle verification follows a symlinked oracle directory and executes outside the source root

## Summary

`verifyOracle()` computes the verification working directory as `<source>/<id>/oracle`, but does not reject a symbolic link at that directory. A local eval definition can therefore execute its configured verification command with an external working directory and external `ORACLE_DIR` environment location.

## Reproduction

From the repository root, create a local eval whose `oracle` directory points outside its source tree and whose harmless verification command writes its current directory:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/source/case" "$probe/outside/oracle"
cat > "$probe/source/case/eval.yaml" <<'EOF'
id: case
title: Local eval
target:
  repo: local
  ref: main
oracle:
  path: oracle
budget:
  max_iterations: 1
  max_tokens: 100
  wall_clock_ms: 1000
judge:
  agent: codex
  model: openai/gpt-5
  rubric:
    - completeness
weights:
  tests: 1
  judge: 0
verify:
  command: "pwd > verify-cwd.txt"
  timeout_ms: 1000
EOF
cat > "$probe/source/case/plan.md" <<'EOF'
---
kind: plan
---
# Local plan
EOF
ln -s "$probe/outside/oracle" "$probe/source/case/oracle"

cat > "$probe/repro.mts" <<EOF
import { openSource } from "file://$PWD/packages/agent-eval/src/source/open.ts";
import { verifyOracle } from "file://$PWD/packages/agent-eval/src/run/oracle.ts";

const source = await openSource("$probe/source");
console.log(JSON.stringify(await verifyOracle(source, "case")));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/source/case/oracle"
cat "$probe/outside/oracle/verify-cwd.txt"

nl -ba packages/agent-eval/src/run/oracle.ts | sed -n '11,35p;73,109p'
```

## Observed Behavior

Oracle verification succeeds while the command executes in the external symlink target and creates its marker outside the eval source:

```text
<probe>/source/case/oracle -> <probe>/outside/oracle
{"passed":true,"output":""}
<probe>/outside/oracle/verify-cwd.txt contains: <probe>/outside/oracle
```

`verifyOracle()` builds the textual oracle path with `path.resolve(source.rootDir, id, "oracle")` and forwards it as both process `cwd` and `ORACLE_DIR` without canonical containment validation.

## Expected Behavior

Oracle verification should run only within canonical oracle directories contained in the configured eval source. A symlinked oracle directory escaping the source root should be rejected before launching any verification command.

## Impact

Reviewing or validating a local eval can execute configured shell behavior in an external filesystem location, allowing writes or other side effects outside the eval source boundary. This is distinct from loading external plan or metadata files because it redirects command execution itself.
