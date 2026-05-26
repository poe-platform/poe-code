# Pipeline named steps follow a symlinked global directory and load external agent instructions

## Summary

Named pipeline step loading falls back to `<home>/.poe-code/pipeline/steps/<name>.yaml`, but does not reject a symbolic link at the global `steps` directory path. If the directory points outside the user state root, `loadResolvedSteps({ name })` loads external prompts and agent selections as global pipeline step configuration.

## Reproduction

From the repository root, expose an external named-step directory through the expected global pipeline path and load a named configuration through the exported API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project" "$probe/home/.poe-code/pipeline" "$probe/outside-steps"
cat > "$probe/outside-steps/review.yaml" <<'EOF'
steps:
  review:
    prompt: External global named step prompt
    agent: codex
EOF
ln -s "$probe/outside-steps" "$probe/home/.poe-code/pipeline/steps"

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { loadResolvedSteps } from "file://$PWD/packages/pipeline/src/config/loader.ts";

console.log(
  JSON.stringify(
    await loadResolvedSteps({
      cwd: "$probe/project",
      homeDir: "$probe/home",
      name: "review",
      fs: fs as any
    })
  )
);
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/home/.poe-code/pipeline/steps"

nl -ba packages/pipeline/src/config/loader.ts | sed -n '243,258p;314,354p'
```

## Observed Behavior

The named-step loader accepts the external target as the global pipeline steps directory and returns executable external configuration:

```text
<probe>/home/.poe-code/pipeline/steps -> <probe>/outside-steps
{"steps":{"review":{"mode":"yolo","prompt":"External global named step prompt","agent":"codex"}}}
```

`resolveStepsDirectory()` regards the symlink as an existing global directory. `loadResolvedSteps()` then joins `review.yaml` below that path and reads the external YAML document without validating canonical state-root containment.

## Expected Behavior

Named global pipeline steps should be loaded only from canonical YAML files inside the selected user's `.poe-code/pipeline/steps` directory. Symlinked directories escaping the user state root should not provide executable prompts or agent choices.

## Impact

An attacker able to influence the global steps path can redirect named pipeline-step selection to external instructions, causing subsequent workflow execution to use prompts and agents not stored in expected state. This is a separate loading surface from the global `steps.yaml` configuration file.
