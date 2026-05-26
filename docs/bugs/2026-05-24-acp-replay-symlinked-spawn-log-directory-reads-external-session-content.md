# ACP replay follows a symlinked spawn-log directory and reads external session content

## Summary

The exported ACP replay helpers enumerate default logs from `$HOME/.poe-code/spawn-logs` and read selected JSONL files without validating where the directory resolves. If that directory is a symbolic link to an external location, `listSpawnLogs()` presents external JSONL files as poe-code session logs and `readSpawnLog()` discloses their contents.

## Reproduction

From the repository root, point the default spawn-log directory at an external JSONL fixture, then list and read logs through the exported API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/outside"
ln -s "$probe/outside" "$probe/home/.poe-code/spawn-logs"
printf '%s\n' '{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"external replay secret"}}' \
  > "$probe/outside/20260524-123456-789-codex.jsonl"

cat > "$probe/repro.mts" <<EOF
import { listSpawnLogs, readSpawnLog } from "file://$PWD/packages/agent-spawn/src/acp/replay.ts";

const logs = await listSpawnLogs({ agent: "codex" });
console.log("logs=" + JSON.stringify(logs));
const updates = [];
for await (const update of readSpawnLog(logs[0].path)) updates.push(update);
console.log("updates=" + JSON.stringify(updates));
EOF

HOME="$probe/home" "$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/home/.poe-code/spawn-logs"

nl -ba packages/agent-spawn/src/acp/replay.ts | sed -n '90,190p'
```

## Observed Behavior

The listing API returns a path textually beneath the poe-code state tree even though the matched file resides in the external target, and log reading emits the external content:

```text
logs=[{"path":"<probe>/home/.poe-code/spawn-logs/20260524-123456-789-codex.jsonl","filename":"20260524-123456-789-codex.jsonl","agent":"codex","timestamp":"2026-05-24T12:34:56.789Z"}]
updates=[{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"external replay secret"}}]
<probe>/home/.poe-code/spawn-logs -> <probe>/outside
```

`listSpawnLogs()` joins `homedir()` with `.poe-code/spawn-logs`, reads its directory entries, and exposes joined child paths. `readSpawnLog()` opens and parses the supplied listed path; no canonical-boundary check prevents the default state path from traversing an existing directory symlink.

## Expected Behavior

Default replay discovery should expose only session logs canonically stored within the selected user's poe-code spawn-log directory. A symlinked log root that escapes the state directory should be rejected rather than treated as normal replay history.

## Impact

An attacker or corrupted state able to place a symlink at `$HOME/.poe-code/spawn-logs` can cause normal replay listings and replay operations to ingest arbitrary suitably named JSONL content from an external directory. This can disclose external data in the replay UI or misrepresent fabricated external sessions as poe-code activity.
