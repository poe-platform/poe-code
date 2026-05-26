# Poe Agent transcript follows a symlinked log file and appends session output outside the log root

## Summary

The Poe Agent transcript writer accepts a `logPath` and appends ACP session updates to it, but does not reject a symbolic link at the selected log file. If a nominal log file points outside its log directory, `createTranscriptWriter()` appends model output and tool/session updates to the external target.

## Reproduction

From the repository root, create a disposable log path symlinked to an external JSONL file and write a harmless message event through the exported transcript API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/logs" "$probe/outside"
ln -s "$probe/outside/transcript.jsonl" "$probe/logs/session.jsonl"

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { createTranscriptWriter } from "file://$PWD/packages/poe-agent/src/runtime/transcript.ts";

const writer = createTranscriptWriter({
  logPath: "$probe/logs/session.jsonl",
  fs: {
    mkdir: async (filePath, options) => { await fs.mkdir(filePath, options); },
    appendFile: async (filePath, contents) => { await fs.appendFile(filePath, contents, "utf8"); }
  }
});
await writer.write({ type: "message.delta", content: "external transcript" } as any);
console.log(await fs.readFile("$probe/outside/transcript.jsonl", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/logs/session.jsonl"

nl -ba packages/poe-agent/src/runtime/transcript.ts | sed -n '70,140p'
nl -ba packages/poe-agent/src/agent.ts | sed -n '193,203p;432,435p'
```

## Observed Behavior

The transcript writer reports and uses the local-looking log file path, but its append operation materializes external session content through the symlink target:

```text
<probe>/logs/session.jsonl -> <probe>/outside/transcript.jsonl
{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"external transcript"}}
```

`resolveTranscriptFilePath()` returns `logPath` unchanged, and `write()` calls the provided append implementation after only ensuring the textual parent directory exists. No canonical containment validation is performed on the transcript file.

## Expected Behavior

Session transcripts intended for a selected log directory should be appended only to canonical files inside that directory. A symlinked log file escaping the log root should be rejected rather than used for persistent session output.

## Impact

Agent message output, tool-call details, usage updates, and other transcript events can be written into external files while appearing to be stored under a legitimate local log path. This can disclose session data or corrupt unrelated files outside the intended logging boundary.
