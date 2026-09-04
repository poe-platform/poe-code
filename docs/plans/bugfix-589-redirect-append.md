# Issue #589: amortize EOF redirect writes

## Validated defect

On random-access adapters, eight awaited three-byte writes through `>` submit
`0, 3, 6, 9, 12, 15, 18, 21, 24` bytes to `writeFile`: 108 rewritten bytes for
24 emitted bytes. The shell also replaces its retained byte image per chunk.
Standalone append and sequential streaming routes do not share this full-rewrite
behavior. No large timing or RSS workload is needed to validate it.

## Scope and invariants

- Preserve immediate visibility after awaited writes, serialized file operations,
  independent and duplicated descriptor offsets, nested truncation and zero gaps.
- Retain a logical-length byte view over geometrically grown backing storage.
  Append at cached EOF only after checking actual EOF and append capability.
- Metadata probing is an optimization: unavailable metadata falls back to the
  previous rewrite path; caller cancellation remains primary. No file reads or
  new read permissions are required.
- Prepare retained storage before backend writes, but publish its logical view
  and advance offsets only after successful writes. Overlap/gap fallback uses a
  fresh buffer and retains the existing full-file write semantics.
- Length-changing direct VFS mutations use the previous rewrite fallback.
  Same-length direct mutations followed by an EOF append now preserve the actual
  mutated prefix instead of overwriting it with the stale shell mirror. This is
  an intentional observable change, not general external-mutation compatibility,
  transactional rollback, or concurrent-writer isolation. A later overlapping
  write still uses the legacy cached prefix: the mirror does not track direct
  external mutations.
- Empty sink writes retain their existing no-op behavior. Ownership, abort and
  completion remain with `openFileOutput`; no delayed visibility or batching.
- Ordinary EOF growth becomes amortized linear in retained copying and submitted
  bytes. Overlapping writes may still rewrite the file; no general RSS claim.

## Verification

Add small in-memory red tests to the maintained lifecycle suite: operation sizes,
geometric retained capacity, awaited visibility, mutation boundaries, zero writes,
metadata fallback/cancellation, and failures before backend effects. Preserve
existing write-only, overlap, mixed-append, duplicate and nested-truncation cases.
Then run related streaming, descriptor, cleanup and byte-value checks, the selected
workspace build, independent review and root-owned maintained lint. No README
changes. Root owns commit, push, issue closure and release monitoring.

## Completed checks — September 4, 2026

- TDD: six initial regressions failed before implementation; the later
  unsupported-stat control also failed before its fix. Final focused cohort:
  16 passed; complete lifecycle suite: 29 passed.
- Related streaming, descriptor, cleanup and output checks: 299 passed. Root's
  broader top-level shell and filesystem-output cohort: 2,030 passed, zero failed.
- Maintained selected build: `npm run build:workspaces -- --workspace=virtual-bash`
  passed the safe-fs/virtual-bash dependency closure.
- Public `poe-code/safe-bash` plus `poe-code/safe-fs` smoke: eight awaited
  three-byte writes issued one empty truncate and eight three-byte appends;
  each completed write was immediately visible.
- Independent read-only review passed, including 18 focused lifecycle cases and
  extra ownership, falsey-cancellation and selected-path capability probes.
- Maintained consumer typecheck passed all three source groups, 25 packed groups
  and three exact negative controls. This is not runtime/provider acceptance or
  a claim that the unrelated global fixture typecheck issue is fixed.
- Root `npm run lint:eslint`: 9,650 configured inputs linted, zero errors or
  warnings, 25 receipts; `git diff --check` passed.
- Checks used the current worktree while preserving unrelated user edits;
  only this issue's runtime, lifecycle tests and plan belong to its commit.
