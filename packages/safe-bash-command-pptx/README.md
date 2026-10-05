# pptx commands

Run PowerPoint document operations in a virtual filesystem using a built-in document engine.

```ts
import { pptxCommands } from "@poe-platform/safe-bash/commands/pptx";

shell.use(pptxCommands());
```

The engine receives invocation arguments and cancellation signals. File access and output stay within the virtual shell.

Set `limits.maxArgumentBytes` to bound the bytes admitted before the engine runs. The engine controls document input and output budgets. Both single-command and command-list factories are available for custom registration.

Pass `engine` to use a custom document engine. Custom engines receive
`request.streaming.openInput(path, maxBytes)` for immutable retained snapshots,
`stdout` and `stderr` sinks, and `workingStorage` for retained archive operations.
Snapshots use the caller's filesystem, spill through a bounded cache into
`TMPDIR` (or the current directory), and expire when execution finishes. File
inputs use retained reads with verifiable identity/version metadata when available,
or copy streaming reads incrementally. Buffered-only backends retain a readFile
convenience fallback;
`-` snapshots stdin for replay. Replay offsets and identity observations live in
caller storage alongside payloads under a shared 1 MiB page cache; a 128-entry
source cache keeps repeated reads cheap without retaining every source object.
Identity-scope capabilities are weakly labeled rather than strongly retained.
Memory-backed filesystems keep spilled data in
memory, so large inputs need an external storage backend.

`publishOutput` also accepts a byte source and retained `originalBytes`. Streamed
publication requires retained atomic staging with ancestry and commit guards.
The adapter writes bounded chunks to owned staging, rechecks in-place input,
and publishes conditionally. Errors and cancellation retire staging without
publishing partial output; dry-run does not consume the output source.

The built-in `validate`, `inspect`, `text get`, `text frames list/get`, `fields list`,
`fields get`, `notes list/get`, `diff` (all supported modes) and `xml get` operations use retained input and caller-backed indexes.
Inspection, text, frame, field, speaker-note and XML extraction stage complete responses before
writing stdout, so admission and output-limit failures expose no partial result. `slides set`
and `xml set` also stage edits, archive bytes and response metadata in caller
storage before streamed atomic publication. XML replacement files use retained
input snapshots and keep their protected input identity. Unchanged edits reuse the exact input
bytes. Streaming engine requests accept source-based publication; requests without
streaming retain the buffered publication contract. `extract` also streams member
bytes and keeps its complete manifest and partial-failure records in caller storage.
Every destination is preflighted before writing. Use `publishOutputStreams` for a
trusted all-or-nothing transaction over an async iterable, optionally with
`preflightOutputStream`; otherwise extraction requires `--allow-partial-output`.
Explicit legacy `publishOutputs`/`preflightOutput` callbacks retain the buffered
compatibility path unless their stream counterparts are supplied. `pack` parses its
manifest into caller storage, streams member admission and stages the complete ZIP
before publication. It preserves hashes, package guards, protected input identity,
force/dry-run and binary stdout. Stream publication callbacks may receive
`protectedInputPaths` as an async iterable; consume it before publishing.
Other operations
still use buffered document models during their streaming migration.

The command owns PowerPoint argument parsing, schemas, discovery and execution.
Shared presentation and byte operations remain internal engine APIs bundled with
the public Safe Bash package; no additional package installation is required.
