# Launch logs follows a symlinked process directory and reads outside launch state

## Summary

`readManagedLogs()` resolves logs below `baseDir/<id>/logs` without validating the canonical process directory. A valid process id whose directory is a symlink to an external location causes log reads to disclose external files as managed-process output.

## Reproduction

From the repository root, create a disposable launch root with a symlinked normal process id and invoke the exported log API:

```sh
repo=$PWD
probe=$(mktemp -d)
base="$probe/launch"
outside="$probe/outside"
mkdir -p "$base" "$outside/logs"
ln -s "$outside" "$base/api"
printf 'external-log\n' > "$outside/logs/stdout.log"

cat > "$probe/repro.mts" <<EOF
import { readManagedLogs } from "file://$PWD/packages/process-launcher/src/index.ts";

console.log(JSON.stringify(await readManagedLogs({ baseDir: "$base", id: "api" })));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/process-launcher/src/launcher.ts | sed -n '244,252p;617,628p'
nl -ba packages/process-launcher/src/logs/log-writer.ts | sed -n '10,14p;139,154p'
```

## Observed Behavior

The log reader follows `launch/api -> outside` and returns the external log content:

```text
["external-log"]
```

The supplied id is simply `api`; the read escapes only because the in-root process directory is a symlink and no canonical containment check is applied.

## Expected Behavior

Managed log reads should stay under the canonical launch state directory. Logs beneath a process directory that resolves outside that root should not be read or displayed.

## Impact

A crafted launch-state symlink can make normal log inspection commands disclose arbitrary external log-shaped files to callers, bypassing the intended boundary even after identifier traversal is blocked.
