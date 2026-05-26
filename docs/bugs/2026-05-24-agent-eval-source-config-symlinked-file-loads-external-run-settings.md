# Agent Eval source configuration follows a symlinked file and loads run settings outside the source root

## Summary

`loadSourceConfig()` reads `<source>/.poe-code-eval.json` without rejecting a symbolic link at that path. A local eval source can therefore present an external JSON file as its run configuration and silently supply external output and judge settings.

## Reproduction

From the repository root, create a source directory whose configuration file is a symlink to an external JSON document, then load the source config directly:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/source" "$probe/outside"
cat > "$probe/outside/config.json" <<'EOF'
{"out":"external-runs","judge":{"agent":"codex","model":"outside-model"}}
EOF
ln -s "$probe/outside/config.json" "$probe/source/.poe-code-eval.json"

cat > "$probe/repro.mts" <<EOF
import { loadSourceConfig } from "file://$PWD/packages/agent-eval/src/source/config.ts";

const config = await loadSourceConfig({ rootDir: "$probe/source" });
console.log(JSON.stringify(config));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/source/.poe-code-eval.json"
cat "$probe/outside/config.json"

nl -ba packages/agent-eval/src/source/config.ts | sed -n '19,51p'
```

## Observed Behavior

The source configuration loader follows the symlink and returns values read from the external document:

```text
{"judge":{"agent":"codex","model":"outside-model"},"out":"external-runs","weights":{"tests":0.7,"judge":0.3},"clone_cache_dir":null}
<probe>/source/.poe-code-eval.json -> <probe>/outside/config.json
```

`loadSourceConfig()` constructs the local-looking path with `join(source.rootDir, ".poe-code-eval.json")` and calls `readFile()` on it without checking the canonical target stays inside `source.rootDir`.

## Expected Behavior

Source configuration should be read only from canonical files contained in the configured source root. A symlinked `.poe-code-eval.json` that escapes that root should be rejected rather than treated as trusted local configuration.

## Impact

Opening or running an eval source can load externally controlled run destinations and judge configuration while attributing them to the local source directory. This can redirect generated runs or alter evaluator selection based on content outside the reviewed eval tree.
