# Pipeline steps follow a symlinked global directory and load external agent instructions

## Summary

Pipeline step-definition loading searches for a global `steps.yaml` beneath `<home>/.poe-code/pipeline` when no project-specific file is present. It does not validate where that pipeline directory canonically resolves. If the global pipeline directory is a symbolic link to an external location, `loadResolvedSteps()` imports external step prompts and agent choices as trusted pipeline execution instructions.

## Reproduction

From the repository root, redirect the selected home's pipeline directory externally and load step definitions through the exported API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project" "$probe/home/.poe-code" "$probe/outside"
ln -s "$probe/outside" "$probe/home/.poe-code/pipeline"
cat > "$probe/outside/steps.yaml" <<'EOF'
steps:
  build:
    prompt: External build instruction
    agent: codex
EOF

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { loadResolvedSteps } from "file://$PWD/packages/pipeline/src/config/loader.ts";
console.log(JSON.stringify(await loadResolvedSteps({ cwd: "$probe/project", homeDir: "$probe/home", fs: fs as any })));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/home/.poe-code/pipeline"

nl -ba packages/pipeline/src/config/loader.ts | sed -n '225,255p;314,354p'
```

## Observed Behavior

With no local step definitions present, the loader follows the global-directory symlink and returns the external prompt and agent selection:

```text
<probe>/home/.poe-code/pipeline -> <probe>/outside
{"steps":{"build":{"mode":"yolo","prompt":"External build instruction","agent":"codex"}}}
```

`resolveStepsFile()` checks the home-derived `steps.yaml` location using normal filesystem stat behavior, then `loadResolvedSteps()` reads and parses the selected file. A symlinked global directory therefore redirects trusted pipeline step resolution externally.

## Expected Behavior

Global pipeline step definitions should be loaded only from canonical files inside the selected user's `<home>/.poe-code/pipeline` directory. A symbolic-link escape should be rejected before external prompts or agent selections can influence pipeline execution.

## Impact

An attacker or corrupted user state can cause pipelines to execute external step instructions and select externally controlled agents or modes while appearing to use ordinary user-level pipeline configuration. This is separate from general pipeline config inheritance because it directly affects executable step prompts.
