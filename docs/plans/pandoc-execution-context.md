# Pandoc execution context

Scope: the original TypeScript `packages/pandoc` execution context. Preserve the
existing unrelated edit in `pandoc-typescript-safe-bash.md`. No push or release.
No new format implementations, native fallback, or command registration.

## Implementation and QA procedure

1. Read root/applicable instructions and inspect the current orchestration and AST.
2. Write original failing tests for budget boundaries, incremental decoding,
   ownership, sink rejection/backpressure, cancellation and deterministic progress.
3. Implement one invocation-owned execution context shared by every reader/writer.
   Add finite format-specific ceilings without pretending absent format adapters
   implement them. Keep encoding/input budget decisions declarative.
4. Exercise one-byte chunks, every split of original multibyte text, per-input BOMs,
   invalid trailing sequences, producer reuse, awaited sink failure, and cancellation
   using controlled promises/schedulers, with no time-based sleeps or host fixtures.
5. Verify AST depth/nodes, logical table spans and reference-index reservations;
   exercise CPU cancellation during AST traversal, decoding and output encoding.
6. Run maintained package test and lint/typecheck routes and the selected workspace
   build closure. Inspect the public built export, diff and whitespace.
7. Stage only owned source/tests and this plan/documentation/evidence. Make a
   Conventional Commit on main; report its local hash separately from delivery.

Unit tests need no filesystem mutations; fixtures are original in-memory values.
No LLMs, downloads, external executables or native format comparators are used in
unit tests. There is no visual CLI change and no screenshot acceptance claim.
The safe-bash command seam remains absent; a future adapter must delegate to this
package and pass through the host signal, capabilities and limits.

## Status

Implementation and original regression tests complete. Maintained package tests,
lint/typecheck, selected workspace build and built public-export QA pass. One
atomic local Conventional Commit is the delivery step; no push/release authorized.
Execution contract/defaults and verification evidence belong
in `docs/pandoc/execution-context.md` and `execution-context-evidence.md`.
