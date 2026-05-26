# Memory `queryMemory()` and `explainPage()` discard successful agent answer output

## Summary

The public memory query and explanation APIs spawn a configured CLI agent, but they cast the agent runner's process-result object directly to `QueryResult` instead of parsing its stdout into the documented structured answer. Even when the spawned agent emits a valid JSON answer with citations and exits successfully, both APIs return objects with missing `answer`, `citations`, and `tokensUsed` fields.

## Reproduction

From the repository root, use a disposable memory fixture and a fake `claude` executable that writes a valid memory-answer payload to stdout:

```sh
repo=$PWD
probe=$(mktemp -d)
root="$probe/project/.poe-code/memory"
mkdir -p "$root/pages" "$probe/bin"

printf '# Memory index\n- [facts](pages/facts.md)\n' > "$root/INDEX.md"
printf '# Facts\n\nKnown value.\n' > "$root/pages/facts.md"

cat > "$probe/bin/claude" <<'EOF'
#!/bin/sh
printf '%s\n' '{"answer":"Known value.","citations":[{"relPath":"pages/facts.md","confidence":"extracted"}],"tokensUsed":12,"exitCode":0}'
exit 0
EOF
chmod +x "$probe/bin/claude"

cat > "$probe/repro.mts" <<EOF
import { queryMemory } from "file://$PWD/packages/memory/src/query.ts";
import { explainPage } from "file://$PWD/packages/memory/src/explain.ts";

console.log("query=" + JSON.stringify(await queryMemory("$root", {
  question: "known?",
  budget: 4096
})));
console.log("explain=" + JSON.stringify(await explainPage("$root", {
  relPath: "pages/facts.md",
  budget: 4096
})));
EOF

PATH="$probe/bin:$PATH" "$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/memory/src/query.ts | sed -n '30,45p'
nl -ba packages/memory/src/explain.ts | sed -n '40,60p'
```

## Observed Behavior

The fake agent exits `0` after writing a complete JSON response, but the exported APIs return:

```text
query={"budget":4096,"exitCode":0}
explain={"budget":4096,"exitCode":0,"inboundPages":[],"outboundSources":[]}
```

`answer`, `citations`, and `tokensUsed` disappear because `spawn()` returns a command execution result containing `stdout`, `stderr`, and `exitCode`, while `queryMemory()` and `explainPage()` read nonexistent structured fields directly from that process result via `as unknown as QueryResult`.

## Expected Behavior

When the selected agent successfully produces a response in the required answer format, `queryMemory()` and `explainPage()` should parse and validate that response, returning its answer, citations, token usage, and exit status. They should not return success-shaped results with required answer data silently omitted.

## Impact

The exported memory retrieval APIs cannot deliver agent-generated answers through their real spawn path. SDK consumers receive incomplete results even on successful execution, which breaks memory Q&A/explanation integrations and can incorrectly appear as a successful but empty answer.
