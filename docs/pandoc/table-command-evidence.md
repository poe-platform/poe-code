# Byte-only adapter verification

Four original command tests failed before createPandocCommand existed. All now
pass: one-byte stdin CSV conversion; strict/explicit-lossy JSON table projection
with exact stderr paths; missing/duplicate/unknown/file argument rejection before
stdin acquisition; inspection, cancellation and sink-failure handling.

Final package run: 535 passed in 15 files. Package lint/typecheck and selected
@poe-code/pandoc build passed. These scoped checks do not imply a repository-wide
gate, registered default shell command, upstream parity or native runtime usage.
The command factory is opt-in and structurally accepts safe-bash byte streams.

Manual screenshot table-command.png was generated using the maintained screenshot
route and viewed: actual built HTML reader -> SDK conversion -> byte-only command
adapter, with the same original colspan table in strict and explicit-lossy modes.
Strict: exit 2, E_CAPABILITY with cell path and no document output. Lossy: exit 0,
one W_TABLE_LOSS with that path, a literal rectangular GFM table, span anchor text
once and an empty covered slot. Both paths and table rows are visible/unclipped.
This is adhoc validation, not a screenshot unit test or deployed-shell acceptance.

No unit filesystem mutation, external executable, LLM or downloaded fixture was
used. Manual screenshot generation writes only this task's evidence. Local commits
only; no push or release was authorized or performed.
