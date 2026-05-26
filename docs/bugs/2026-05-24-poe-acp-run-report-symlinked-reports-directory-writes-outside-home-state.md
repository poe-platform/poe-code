# Poe ACP run report follows a symlinked reports directory and writes outside home state

## Summary

`saveRunReport()` persists JSON and text summaries under `<home>/.poe-code/reports`, but does not reject a symbolic link at that reports directory. A selected home directory can therefore redirect session report contents to an external filesystem location.

## Reproduction

From the repository root, link the nominal reports directory to an external location and save a harmless report through the exported API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/outside"
ln -s "$probe/outside" "$probe/home/.poe-code/reports"

cat > "$probe/repro.mts" <<EOF
import { saveRunReport } from "file://$PWD/packages/poe-acp-client/src/run-report.ts";

const paths = await saveRunReport({
  runId: "safe",
  startTime: "2026-05-24T00:00:00.000Z",
  endTime: "2026-05-24T00:00:01.000Z",
  exitStatus: "success",
  toolCalls: [],
  usage: { used: 0, size: 0, updates: 0 },
  errors: []
}, {
  homeDir: "$probe/home",
  now: () => new Date("2026-05-24T00:00:02.000Z")
});
console.log(JSON.stringify(paths));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/home/.poe-code/reports"
find "$probe/outside" -maxdepth 1 -type f -print | sort
cat "$probe/outside/20260524-000002-000-safe.txt"

nl -ba packages/poe-acp-client/src/run-report.ts | sed -n '135,160p;246,268p'
```

## Observed Behavior

The writer returns local-looking report paths, but both artifacts are created in the external symlink target:

```text
{"reportsDir":"<probe>/home/.poe-code/reports","jsonPath":"<probe>/home/.poe-code/reports/20260524-000002-000-safe.json","summaryPath":"<probe>/home/.poe-code/reports/20260524-000002-000-safe.txt"}
<probe>/home/.poe-code/reports -> <probe>/outside
<probe>/outside/20260524-000002-000-safe.json
<probe>/outside/20260524-000002-000-safe.txt
```

## Expected Behavior

Run reports should be written only to canonical files contained within the selected user's Poe state directory. A symlinked reports directory escaping that root should be rejected before writing any report content.

## Impact

Persisting ACP session reports can leak tool-call, timing, usage, and error metadata outside the configured home state directory and overwrite files in an externally selected reports destination.
