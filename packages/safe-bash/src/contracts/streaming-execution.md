# Streaming execution

`Shell.exec(source, { captureOutput: false, stdout, stderr })` and session exec
forward output to awaited `ByteSink` writes. Omitted sinks discard output.
The default (or `true`) still returns owned binary captures and decoded text.
Noncapturing results and state hooks keep the existing result shape with empty
stdout/stderr byte and text fields and normal exit/state metadata. Output budgets
still apply before delivery, including discarded streams. No default quotas change.
The CLI and timeout-worker transport select noncapturing execution.

There is no output spool: no host temp directory, private filesystem, injected
filesystem file, or payload-wide concatenation is needed for terminal output.
Injected filesystem redirections and commands retain their existing contracts.
Await each write. A sink that retains a chunk beyond settlement must copy it;
producers can reuse storage after an awaited write. Pipeline transport additionally
holds its bounded queue and active producer/consumer chunks. Choose bounded producer
chunk sizes and `pipeHighWaterMark`; a high-water mark is not a maximum chunk size.
Destination-specific `ownedOutput` enrollment is forwarded through budget wrappers.
Cancellation and failures retain existing outcome selection and cleanup settlement:
ordinary command errors can become exit status 1; caller cancellation rejects with
the caller reason. Sinks remain caller-owned and are not automatically closed.

## Retention boundaries

- Nested `sh`, functions, subshells and `context.invoke` inherit sinks and shared
  budgets. They do not introduce terminal captures. A host explicitly calling
  another `shell.exec` must select its own capture policy.
- Ordinary exec drains background children. Session turns may return before jobs
  finish; their original sinks must remain usable until completion/disposal.
  Noncapturing jobs retain descriptors, state and job metadata, not terminal
  output. Saved job statuses and shell state can still grow with job/program size.
- `$(...)` captures stdout because the result becomes a shell value; trailing
  newlines are removed. Stderr still streams. Its capture consumes the shared
  `maxOutputBytes` budget before retention; values/expansions also use
  `maxExpansionBytes` and `maxExpansionFields`. Captures, joined bytes, decoded
  values and state snapshots can coexist. This is proportional semantic memory,
  not constant-memory evaluation of arbitrary shell programs.
- Process substitution currently materializes data in the caller's filesystem
  and has capture/readFile boundaries. It is not a bounded streaming path.
  MemoryFileSystem stores file contents in RAM. Switching terminal capture off
  does not qualify process substitution, a buffering command, or a RAM-backed
  file spool as bounded Worker execution.
- Source text, parsed syntax, variables, arrays, arguments, retained sessions and
  hooks are separate from output transport. Quotas remain opt-in. Callers choose
  limits or external filesystem storage where supported; this mode adds no
  lower file-size limits and removes no shell operations.

Tests instrument captures and injected filesystem payload operations, send reused
chunks through slow sinks, and verify bounded outstanding transport bytes, nested
execution, background sessions, byte identity, ownership, quotas and cleanup.
These are deterministic architectural checks, not measurements of Worker peak
memory. See the [Worker QA plan](../../../../docs/plans/safe-bash-streaming-worker-qa.md)
for deployment qualification and its explicit unmeasured dimensions.
