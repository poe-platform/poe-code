# Agent Eval loading follows a symlinked definition file and loads external target configuration

## Summary

The exported Agent Eval `loadEval()` API reads `<source>/<id>/eval.yaml` for a valid local eval id, but does not reject a symbolic link at that definition file. A locally listed eval can therefore inherit target repository, ref, judge, budget, and other execution settings from an external YAML document.

## Reproduction

From the repository root, create a local eval directory with a local plan but an externally linked definition file, then load it through the package API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/source/case" "$probe/outside"
cat > "$probe/outside/eval.yaml" <<'EOF'
id: case
title: External eval metadata
target:
  repo: external-repo
  ref: foreign
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
EOF
cat > "$probe/source/case/plan.md" <<'EOF'
---
kind: plan
---
# Local plan
EOF
ln -s "$probe/outside/eval.yaml" "$probe/source/case/eval.yaml"

cat > "$probe/repro.mts" <<EOF
import { openSource } from "file://$PWD/packages/agent-eval/src/source/open.ts";
import { loadEval } from "file://$PWD/packages/agent-eval/src/source/registry.ts";

const source = await openSource("$probe/source");
const result = await loadEval(source, "case");
console.log(JSON.stringify({ title: result.title, repo: result.target.repo, ref: result.target.ref }));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/source/case/eval.yaml"

nl -ba packages/agent-eval/src/source/open.ts | sed -n '11,42p'
nl -ba packages/agent-eval/src/source/registry.ts | sed -n '10,38p;40,80p'
```

## Observed Behavior

The eval directory is discovered through its local path, but loading it reads external definition metadata and returns the external target selection:

```text
<probe>/source/case/eval.yaml -> <probe>/outside/eval.yaml
{"title":"External eval metadata","repo":"external-repo","ref":"foreign"}
```

`listEvals()` considers the local `case` directory valid because `eval.yaml` is readable as a file through the link. `loadEval()` then parses that external YAML document without validating canonical source containment.

## Expected Behavior

Eval definitions should load configuration only from canonical `eval.yaml` files contained within the configured source root. A symlinked definition file escaping that root should be rejected rather than used for target or judge configuration.

## Impact

A local eval identifier can be silently redirected to external target and execution settings, changing what repository/ref is evaluated and how results are judged. This allows unreviewed external configuration to control eval behavior even when the local plan document is benign.
