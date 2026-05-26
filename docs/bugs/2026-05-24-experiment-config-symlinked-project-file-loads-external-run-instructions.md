# Experiment config follows a symlinked project file and loads external run instructions

## Summary

Experiment run configuration reads the project-local file `<project>/.poe-code/experiments/run.yaml` directly, but does not reject a symbolic link at that path. If the project configuration file points to an external YAML document, `loadRunConfig()` consumes external prompts as trusted project experiment instructions.

## Reproduction

From the repository root, replace the expected project experiment config file with a symlink to an external document and invoke the exported loader:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/.poe-code/experiments" "$probe/home" "$probe/outside"
cat > "$probe/outside/run.yaml" <<'EOF'
prompt: External project experiment prompt
EOF
ln -s "$probe/outside/run.yaml" "$probe/project/.poe-code/experiments/run.yaml"

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { loadRunConfig } from "file://$PWD/packages/experiment-loop/src/config/loader.ts";
console.log(JSON.stringify(await loadRunConfig({ cwd: "$probe/project", homeDir: "$probe/home", fs: fs as any })));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/project/.poe-code/experiments/run.yaml"

nl -ba packages/experiment-loop/src/config/loader.ts | sed -n '102,135p'
```

## Observed Behavior

The loader reads through the project-local symlink and returns the external prompt as project configuration:

```text
<probe>/project/.poe-code/experiments/run.yaml -> <probe>/outside/run.yaml
{"prompt":"External project experiment prompt"}
```

`loadRunConfig()` constructs the expected project configuration path and immediately reads it using `readOptionalFile()`. Because that operation follows symlinks, the source of trusted run instructions may lie outside the project.

## Expected Behavior

Project experiment configuration should be loaded only from a canonical config file inside the selected project's `.poe-code/experiments` directory. A symlinked file escaping the project should be rejected before its instructions influence execution.

## Impact

A crafted project can make experiment execution consume externally controlled prompts while presenting the file as ordinary local configuration. This can expose or execute unintended instruction content outside the project's trusted configuration boundary.
