# ACP spawn logger follows a symlinked home log directory and writes session events outside the state root

## Summary

The exported ACP `spawnLog` middleware stores session event logs under `$HOME/.poe-code/spawn-logs` by default, but does not verify canonical containment of that directory. If `$HOME/.poe-code/spawn-logs` is a symbolic link to an external directory, processing ACP events creates JSONL session logs outside the poe-code state root while reporting the textual home-based log path.

## Reproduction

From the repository root, invoke the exported middleware with a disposable home whose spawn-log directory points externally:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/outside"
ln -s "$probe/outside" "$probe/home/.poe-code/spawn-logs"

cat > "$probe/repro.mts" <<EOF
import { readFile } from "node:fs/promises";
import { applyMiddlewares } from "file://$PWD/packages/agent-spawn/src/acp/middleware.ts";
import { spawnLog } from "file://$PWD/packages/agent-spawn/src/acp/middlewares/spawn-log.ts";

const ctx = {
  sessionId: "session-1",
  agent: "codex",
  events: [{ type: "message", content: "external log probe" } as any],
  usage: {},
  startedAt: new Date("2026-05-24T12:34:56.789Z")
} as any;
await applyMiddlewares([spawnLog], ctx);
console.log("logFile=" + ctx.logFile);
console.log("external=" + await readFile("$probe/outside/20260524-123456-789-codex.jsonl", "utf8"));
EOF

HOME="$probe/home" "$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/home/.poe-code/spawn-logs"

nl -ba packages/agent-spawn/src/acp/middlewares/spawn-log.ts | sed -n '40,152p'
nl -ba packages/agent-spawn/src/acp/middleware.ts | sed -n '15,48p'
```

## Observed Behavior

The middleware records the apparent home-state log path in `ctx.logFile`, while the JSONL payload is physically written in the external symlink target:

```text
logFile=<probe>/home/.poe-code/spawn-logs/20260524-123456-789-codex.jsonl
external={"type":"message","content":"external log probe"}
<probe>/home/.poe-code/spawn-logs -> <probe>/outside
```

`resolveLogFilePath()` uses `$HOME/.poe-code/spawn-logs` when no explicit log destination is provided. `SpawnLogWriter.ensureOpen()` recursively creates the log parent and opens the event file for append at that path, transparently following an existing directory symlink.

## Expected Behavior

Default ACP spawn event logs should remain within the canonical poe-code state directory of the selected user home. The middleware should reject symlink-mediated directory escapes or otherwise ensure that session event writes cannot reach unrelated external storage.

## Impact

An attacker or damaged local state able to symlink the spawn-log directory can redirect prompts, model events, tool events, and other ACP session data into an unintended writable location outside poe-code's designated state tree. This leaks or persists potentially sensitive session contents where users do not expect them.
