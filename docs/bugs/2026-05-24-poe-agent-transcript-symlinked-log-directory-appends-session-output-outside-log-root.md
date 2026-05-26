# Poe Agent transcript follows a symlinked log directory and appends session output outside the log root

## Summary

The Poe Agent transcript writer supports `logDir` plus `logFileName`, but does not reject a symbolic link at the supplied log directory. If that directory points outside the intended logging tree, `createTranscriptWriter()` appends ACP session updates into external JSONL files while returning a textual in-root log path.

## Reproduction

From the repository root, link a nominal log subdirectory externally and write a harmless message event through the exported transcript API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/logs" "$probe/outside"
ln -s "$probe/outside" "$probe/logs/linked"

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { createTranscriptWriter } from "file://$PWD/packages/poe-agent/src/runtime/transcript.ts";

const writer = createTranscriptWriter({
  logDir: "$probe/logs/linked",
  logFileName: "session.jsonl",
  fs: {
    mkdir: async (filePath, options) => { await fs.mkdir(filePath, options); },
    appendFile: async (filePath, contents) => { await fs.appendFile(filePath, contents, "utf8"); }
  }
});
await writer.write({ type: "message.delta", content: "linked directory" } as any);
console.log(await fs.readFile("$probe/outside/session.jsonl", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/logs/linked"

nl -ba packages/poe-agent/src/runtime/transcript.ts | sed -n '81,140p'
```

## Observed Behavior

The joined path is accepted beneath the textual log directory, but its append operation follows the directory symlink and writes the session event externally:

```text
<probe>/logs/linked -> <probe>/outside
{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"linked directory"}}
```

`resolveTranscriptFilePath()` joins the supplied directory and filename, while `write()` ensures and appends through that unvalidated path without checking where the directory resolves canonically.

## Expected Behavior

Transcript output configured below a log root should remain canonically within that root. A symlinked log directory escaping the selected storage boundary should be rejected rather than used for session persistence.

## Impact

Callers using directory-based transcript configuration can redirect agent messages and tool/session details into external files through a pre-existing symlink. This bypass is independent of a directly symlinked log filename and may affect systems that generate safe filenames themselves.
