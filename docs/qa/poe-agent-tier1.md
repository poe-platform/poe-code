# poe-agent Tier 1 QA

## Persistent session JSONL

1. Start a local script or REPL that calls `createAgentSession({ model, persist: { directory: "/tmp/poe-agent-sessions" } })`.
2. Send a prompt that produces one assistant response.
3. Confirm `/tmp/poe-agent-sessions/<session.id>.jsonl` exists.
4. Confirm each line is one JSON object and includes `user` and `assistant` entries.
5. Call `session.tree()` and confirm it matches the JSONL entries in order.

## Hook decision rewrite

1. Register a plugin with `preToolUse(ctx)` that returns `{ rewrite: { args: { ...ctx.args, command: "pwd" } } }` for `run_command`.
2. Send a prompt that asks the model to run a different shell command.
3. Confirm the observed tool call sent to the host uses `pwd`.
4. Confirm the original command is not executed.

## Hook result replacement

1. Register a plugin with `postToolUse(ctx)` that returns `{ replace: { content: "redacted" } }` for `read_file`.
2. Send a prompt that reads a file.
3. Confirm the next model request receives the tool message content `redacted`.

## Compaction file awareness

1. Run a session with compaction enabled at a low threshold.
2. Read one file and modify one file before compaction triggers.
3. Confirm `preCompaction` and `postCompaction` hooks see the file paths in `readFiles` and `modifiedFiles`.
4. Confirm the compaction summary request mentions the read and modified file lists.
