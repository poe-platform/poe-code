# Agent Eval run evidence follows a symlinked run directory and writes outside the output root

## Summary

`writeRunEvidence()` creates and writes artifact files under a caller-supplied run directory without rejecting a symbolic link at that directory. A run entry located beneath an output root can therefore redirect evidence artifacts into an external filesystem location.

## Reproduction

From the repository root, create a local-looking run directory symlink targeting an external directory, then write harmless run evidence through the exported writer:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/outside"
ln -s "$probe/outside" "$probe/run"

cat > "$probe/repro.mts" <<EOF
import { writeRunEvidence } from "file://$PWD/packages/agent-eval/src/run/result-writer.ts";

await writeRunEvidence("$probe/run", {
  events: [{ type: "probe" }],
  trace: { events: [] },
  cheatReport: { cheated: false, violations: [] },
  planMd: "# external plan\\n",
  evalYaml: "id: external\\n"
});
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/run"
find "$probe/outside" -maxdepth 1 -type f -print | sort
cat "$probe/outside/plan.md"

nl -ba packages/agent-eval/src/run/result-writer.ts | sed -n '23,72p'
```

## Observed Behavior

All evidence artifacts are created under the external symlink target rather than in a contained run directory:

```text
<probe>/run -> <probe>/outside
<probe>/outside/cheat-report.json
<probe>/outside/eval.yaml
<probe>/outside/events.jsonl
<probe>/outside/plan.md
<probe>/outside/trace.json
<probe>/outside/plan.md contains: # external plan
```

Although individual files are atomically renamed, their temporary and final paths are both created in `path.dirname(filePath)`, which is reached through the unvalidated symlinked run directory.

## Expected Behavior

Evaluation artifacts should be written only to canonical run directories contained within the configured output root. A run directory symlink escaping that root should be rejected before any evidence file is created.

## Impact

An evaluation write path can create or replace multiple artifact files outside its output tree, exposing plan and eval contents and mutating external directories. This complements read-side run result escapes by affecting artifact production itself.
