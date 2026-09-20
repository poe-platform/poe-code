# Execution context verification

Verified locally on main, September 16, 2026. Scope is the original TypeScript
`packages/pandoc` execution context; no native fallback or format comparator.
The pre-existing edit in `docs/plans/pandoc-typescript-safe-bash.md` was excluded.

## Original failing evidence

Tests were added before their corresponding implementation changes. The first
maintained package run failed because execution.js was absent. Subsequent
original regressions concretely failed for missing streamed/normalized text,
invalid UTF-8 accepted before readers, absent diagnostic ceilings/reporting,
streaming cleanup missing on close rejection, decoded-text boundary overreservation,
chunk-count-dependent reference admissions, mutable binary output read after the
first sink write, absent RTF byte-decoding helpers, missing table index ceilings,
concurrent double sink close and work charged after decoded growth.

A final original synchronous-host-throw + cancellation fixture failed with E_IO
and an unhandled cancellation rejection. Capturing synchronous throws into the
awaited race and checking the caller signal in the error path fixed both. The
fixture remains in the maintained suite; the final run reports no unhandled errors.

## Maintained checks

| Command | Result |
| --- | --- |
| `npm test --workspace=@poe-code/pandoc` | PASS: 81 tests, three files |
| `npm run lint --workspace=@poe-code/pandoc` | PASS: ESLint plus source/test TypeScript checks |
| `npm run build:workspaces -- --workspace=@poe-code/pandoc` | PASS: maintained declaration-derived selected build closure |
| `git diff --check` | PASS |

Built ESM exports were separately imported by public package name and exercised
with original in-memory reader/writer capabilities: one-byte UTF-8 source with
BOM, split multibyte scalars and mixed newlines produced exactly `é𐀀\nx\ny`;
opaque FF/00 binary retention preserved owned bytes; all 30 finite default keys
were present. This was executed as the plan's manual QA step, not added as a QA
script or a unit test invoking an external executable.

Unit fixtures are original arrays, typed byte buffers, documents, controlled
promises and injected deterministic schedulers. They create no host scratch files,
download no fixtures, invoke no LLMs/external executables, and use no time-based
sleeps. No filesystem mutation is needed, so memfs is unnecessary for this scope.

## Acceptance covered and limits

Every ceiling's reservation API is exercised at max-1/max/max+1; concrete fixtures
also exercise input/output, decoded units/entities, compressed EPUB bytes, binary
blocks, AST nodes/depth/resources, table cells/index capacity and diagnostics at
their boundaries. UTF-8 fixtures cover one-byte input, every chunk size of original
multibyte text, interior/per-input BOMs, split CRLF/CR, invalid leads/continuations,
overlong/surrogate encodings and invalid trailing bytes. Successful documents and
outputs agree across chunk boundaries. Producer reuse and binary sink mutation
do not alter retained/result bytes. Rejected writes/close cannot produce success.

Cancellation is tested before work, at deterministic CPU yield points during
decoding/traversal/output encoding, during pending producer/sink waits, after a
capability/output returns, and after a completed result. Backpressure is gated by
explicit promises. Closed contexts acquire/write no more data. Producer return,
sink abort and concurrent completion are idempotent. Pagination progress must
advance, with a bounded progress index and shared layout-work ceilings.

This is scoped context acceptance, not format conformance or a repository-wide
gate. Built-in format descriptors remain unavailable. EPUB expansion/XML,
LaTeX/RST macro/include/directive and PDF font/glyph/page/object/image/layout caps
are shared, tested admission APIs that those future adapters must use. RTF text
helpers support Windows-1252 and literal Latin-1; unsupported pages fail without
fallback. No safe-bash command exists to validate in this task and no CLI visuals
changed. No screenshot/EPUB/PDF/RTF end-to-end compatibility claim is made.

The converter retains a bounded AST by design. Host allocations and synchronous
uncooperative work cannot be preempted; final bounded AST shape validation/clone
remain synchronous. Pending I/O cancellation cannot undo host side effects, and
uncooperative cleanup can delay settlement. See execution-context.md for the
complete ownership, admission, accounting and cancellation contract.

## Delivery

Local atomic commit only. Remote-main delivery and release were neither requested
nor performed. The local hash is reported in the task's final response.
