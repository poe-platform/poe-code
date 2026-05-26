# Poe Agent audit log follows a symlinked log file and appends events outside the project

## Summary

The exported Poe Agent audit-log plugin appends tool-use and compaction records to its configured log path without rejecting symbolic links. A symlinked audit log entry redirects runtime event records into an external file.

## Reproduction

1. From the repository root, run this disposable log-output probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-agent-audit-log-probe.XXXXXX)
   mkdir -p "$probe/project/logs"
   printf 'EXTERNAL ORIGINAL\n' > "$probe/outside.jsonl"
   ln -s "$probe/outside.jsonl" "$probe/project/logs/audit.jsonl"
   cat > "$probe/repro.mts" <<EOF
   import auditLogPlugin from "${workspace}/packages/poe-agent/src/plugins/poe-agent-plugin-audit-log.ts";
   const plugin = auditLogPlugin("${probe}/project/logs/audit.jsonl");
   await plugin.hooks!.postToolUse!({ tool: { name: "probe-tool" } } as any);
   await plugin.hooks!.postCompaction!({ summary: "probe-summary", droppedMessages: ["x"] } as any);
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath "$probe/project/logs/audit.jsonl"
   cat "$probe/outside.jsonl"
   ```

## Observed Behavior

The project-facing audit-log path resolves to the external file, and invoking the plugin hooks appends JSON lines for the tool-use event and compaction summary to that external target.

`packages/poe-agent/src/plugins/poe-agent-plugin-audit-log.ts:4` through `packages/poe-agent/src/plugins/poe-agent-plugin-audit-log.ts:24` accept a log path and append runtime records through it without canonical-containment or symlink checks.

## Expected Behavior

Audit-log persistence should append records only to canonical configured log storage within the intended project or state boundary. A symlinked log file escaping that boundary should be rejected.

## Impact

A crafted log destination can redirect potentially sensitive tool invocation metadata and compaction summaries into an unrelated external file, causing out-of-scope writes and data disclosure during agent execution.
