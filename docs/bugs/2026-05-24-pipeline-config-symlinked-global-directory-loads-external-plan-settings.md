# Pipeline config follows a symlinked global directory and loads external plan settings

## Summary

Pipeline project configuration is automatically extended with matching global settings from `<home>/.poe-code/pipeline`. The loader does not validate the canonical location of that global directory. If it is a symbolic link to an external directory, loading a project `config.yaml` imports external pipeline settings as trusted user configuration.

## Reproduction

From the repository root, provide a project pipeline config that extends global state and redirect the selected home's pipeline config directory externally:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/.poe-code/pipeline" "$probe/home/.poe-code" "$probe/outside"
ln -s "$probe/outside" "$probe/home/.poe-code/pipeline"
cat > "$probe/project/.poe-code/pipeline/config.yaml" <<'EOF'
extends: true
EOF
cat > "$probe/outside/config.yaml" <<'EOF'
plan_directory: external/pipeline/plans
EOF

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { loadPipelineConfig } from "file://$PWD/packages/pipeline/src/config/loader.ts";
console.log(JSON.stringify(await loadPipelineConfig({ cwd: "$probe/project", homeDir: "$probe/home", fs: fs as any })));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/home/.poe-code/pipeline"

nl -ba packages/pipeline/src/config/loader.ts | sed -n '283,312p'
nl -ba packages/config-extends/src/discover.ts | sed -n '9,37p'
```

## Observed Behavior

The project document specifies only inheritance, while the loader resolves the external global base and returns its `plan_directory` setting:

```text
<probe>/home/.poe-code/pipeline -> <probe>/outside
{"plan_directory":"external/pipeline/plans"}
```

`loadPipelineConfig()` supplies the home-derived pipeline directory as its global base layer and enables automatic config extension. Base discovery then reads the external `config.yaml` reached through the symlink without rejecting the escape.

## Expected Behavior

Global pipeline configuration should be inherited only from canonical files stored inside the selected user's `<home>/.poe-code/pipeline` directory. A symlinked global directory that escapes the state root should not be consumed as trusted pipeline configuration.

## Impact

A corrupted or attacker-controlled home state can redirect pipeline configuration resolution to external settings, influencing plan-directory selection and other inherited execution options while appearing to be ordinary user-level configuration.
