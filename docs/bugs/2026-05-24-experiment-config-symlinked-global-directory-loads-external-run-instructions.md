# Experiment config follows a symlinked global directory and loads external run instructions

## Summary

Experiment run configuration supports project documents that extend a matching global configuration from `<home>/.poe-code/experiments`. The resolver does not check where that global directory canonically resolves. If it is a symbolic link to an external directory, loading a local project run config imports external prompt instructions as trusted experiment configuration.

## Reproduction

From the repository root, point the selected home's experiment config directory at an external base and load a project `run.yaml` declaring inheritance:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/.poe-code/experiments" "$probe/home/.poe-code" "$probe/outside"
ln -s "$probe/outside" "$probe/home/.poe-code/experiments"
cat > "$probe/project/.poe-code/experiments/run.yaml" <<'EOF'
extends: true
EOF
cat > "$probe/outside/run.yaml" <<'EOF'
prompt: External experiment instruction
EOF

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { loadRunConfig } from "file://$PWD/packages/experiment-loop/src/config/loader.ts";
console.log(JSON.stringify(await loadRunConfig({ cwd: "$probe/project", homeDir: "$probe/home", fs: fs as any })));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/home/.poe-code/experiments"

nl -ba packages/experiment-loop/src/config/loader.ts | sed -n '102,135p'
nl -ba packages/config-extends/src/discover.ts | sed -n '9,37p'
```

## Observed Behavior

The local project config contains no prompt, but the loader reads the matching external base through the global-directory symlink and returns its instruction:

```text
<probe>/home/.poe-code/experiments -> <probe>/outside
{"prompt":"External experiment instruction"}
```

`loadRunConfig()` places the home-derived experiment directory into the config-extension base chain, and `findBase()` reads `run.yaml` beneath that base path. No canonical containment check prevents external configuration from being treated as selected-home state.

## Expected Behavior

Global experiment inheritance should read base configuration only from canonical files within the selected user's `<home>/.poe-code/experiments` directory. Symlinked global directories escaping that state root should be rejected before their instructions influence experiment execution.

## Impact

An attacker or corrupted home state can inject arbitrary experiment prompts through an external directory while the project appears only to inherit normal user configuration. Those instructions may be passed to execution agents as trusted workflow content.
