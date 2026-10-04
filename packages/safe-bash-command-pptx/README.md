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
`-` snapshots stdin for replay. Memory-backed filesystems keep spilled data in
memory, so large inputs need an external storage backend.

`publishOutput` also accepts a byte source and retained `originalBytes`. Streamed
publication requires retained atomic staging with ancestry and commit guards.
The adapter writes bounded chunks to owned staging, rechecks in-place input,
and publishes conditionally. Errors and cancellation retire staging without
publishing partial output; dry-run does not consume the output source.

The built-in `validate`, `inspect` and `text get` operations use retained input
and caller-backed indexes. Inspection and text extraction stage complete responses before writing
stdout, so admission and output-limit failures expose no partial result. Other
operations still use buffered document models during their streaming migration.

The command owns PowerPoint argument parsing, schemas, discovery and execution.
Shared presentation and byte operations remain internal engine APIs bundled with
the public Safe Bash package; no additional package installation is required.
