# Experiment journal follows a symlinked sidecar file and reads or appends external history

## Summary

The experiment SDK derives a journal sidecar next to a selected document, such as `probe.journal.jsonl` beside `probe.md`, and passes it to `ExperimentJournal` for initialization, append, and read operations. If the journal sidecar itself is a symbolic link to an external file, ordinary journal logging appends to external history and ordinary journal reads disclose that external content.

## Reproduction

From the repository root, create a normal local experiment document and point its derived journal sidecar at an external JSONL file:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/docs/plans" "$probe/home" "$probe/outside"
printf '%s\n' '---' 'kind: experiment' '---' '# Probe' > "$probe/project/docs/plans/probe.md"
printf '{"commit":"old","status":"keep","scores":{},"durationMs":1,"timestamp":"old"}\n' > "$probe/outside/journal.jsonl"
ln -s "$probe/outside/journal.jsonl" "$probe/project/docs/plans/probe.journal.jsonl"

cat > "$probe/repro.mts" <<EOF
import { readFile } from "node:fs/promises";
import { appendExperimentJournalEntry, readExperimentJournal } from "file://$PWD/src/sdk/experiment.ts";

const options = { cwd: "$probe/project", homeDir: "$probe/home", docPath: "docs/plans/probe.md" };
await appendExperimentJournalEntry({
  ...options,
  entry: { commit: "new", status: "discard", scores: {}, durationMs: 2, timestamp: "new" } as any
});
console.log("external=" + await readFile("$probe/outside/journal.jsonl", "utf8"));
console.log("read=" + JSON.stringify(await readExperimentJournal(options)));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/project/docs/plans/probe.journal.jsonl"

nl -ba src/sdk/experiment.ts | sed -n '26,111p'
nl -ba packages/experiment-loop/src/journal/journal.ts | sed -n '1,100p'
```

## Observed Behavior

The SDK appends the new experiment entry to the external symlink target, then reads both external records back as the selected document's journal:

```text
<probe>/project/docs/plans/probe.journal.jsonl -> <probe>/outside/journal.jsonl
external={"commit":"old","status":"keep","scores":{},"durationMs":1,"timestamp":"old"}
{"commit":"new","status":"discard","scores":{},"durationMs":2,"timestamp":"new"}

read=[{"commit":"old","status":"keep",...},{"commit":"new","status":"discard",...}]
```

`appendExperimentJournalEntry()` computes the sidecar path from the selected local document and calls `journal.init()` followed by `journal.log()`. `ExperimentJournal` uses direct file reads and appends at that derived path, so a pre-existing sidecar symlink is followed without validation.

## Expected Behavior

An experiment journal associated with a local project document should remain a canonical sidecar file in the document's directory. The SDK should reject a journal sidecar symlink that escapes that directory before appending or reading history.

## Impact

A crafted project can redirect experiment-history writes into an arbitrary writable external JSONL file and expose external records as local experiment results. This can corrupt unrelated logs and misrepresent external content as trusted experiment history.
