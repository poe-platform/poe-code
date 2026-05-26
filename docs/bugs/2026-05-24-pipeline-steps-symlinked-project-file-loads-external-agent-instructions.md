# Pipeline steps follow a symlinked project file and load external agent instructions

## Summary

Pipeline step loading prioritizes the project-local file `<project>/.poe-code/pipeline/steps.yaml`, but does not reject a symbolic link at that path. If that file points to an external YAML document, `loadResolvedSteps()` loads external prompts and agent selections as project pipeline steps.

## Reproduction

From the repository root, expose an external step-definition document through the expected project pipeline path and load it through the exported API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/.poe-code/pipeline" "$probe/home" "$probe/outside"
cat > "$probe/outside/steps.yaml" <<'EOF'
steps:
  review:
    prompt: External project step prompt
    agent: codex
EOF
ln -s "$probe/outside/steps.yaml" "$probe/project/.poe-code/pipeline/steps.yaml"

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { loadResolvedSteps } from "file://$PWD/packages/pipeline/src/config/loader.ts";
console.log(JSON.stringify(await loadResolvedSteps({ cwd: "$probe/project", homeDir: "$probe/home", fs: fs as any })));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/project/.poe-code/pipeline/steps.yaml"

nl -ba packages/pipeline/src/config/loader.ts | sed -n '225,255p;314,354p'
```

## Observed Behavior

The loader accepts the external target as the project's highest-priority step-definition file and returns its executable prompt and selected agent:

```text
<probe>/project/.poe-code/pipeline/steps.yaml -> <probe>/outside/steps.yaml
{"steps":{"review":{"mode":"yolo","prompt":"External project step prompt","agent":"codex"}}}
```

`resolveStepsFile()` checks the project path before any global fallback and treats the symlink target as an ordinary file. `loadResolvedSteps()` then reads and parses that path without validating canonical project containment.

## Expected Behavior

Project pipeline steps should be loaded only from canonical step-definition files inside the selected project's `.poe-code/pipeline` directory. Symlinked project files escaping the project should not supply executable prompts or agent choices.

## Impact

A compromised project can redirect step loading to external instructions, causing subsequent pipeline execution to use prompts and agents not stored within project configuration. This can silently inject external workflow behavior at the project-precedence layer.
