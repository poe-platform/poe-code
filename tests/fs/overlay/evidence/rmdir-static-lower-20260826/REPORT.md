# Overlay static-lower rmdir correction

## Decision and minimal change

The blanket ENOTSUP restriction in `3a9177a` was incorrect under this overlay's
preexisting lifetime prerequisites: distinct non-aliasing storage, exclusively
owned upper, and no external lower modification while the instance is in use.
Those prerequisites were already documented at the start of the overlay README.
Readonly capability alone does not establish them, but neither does it negate
the caller's explicit ownership/lifetime obligation.

The correction removes only the unconditional lower-selected/opacity gates.
The existing instance queue, merged-empty check, directory-only/path/root and
permission checks, immediate cancellation check and no-cleanup execution remain.
An upper entry requires successful optional `upper.rmdir` before its whiteout.
A lower-only entry needs no backing mutation: the empty decision and synchronous
instance whiteout are serialized against same-instance namespace operations.
No recursive fallback, staged deletion, new capability, contract field or
cross-provider atomicity claim was introduced.

## Original evidence remains original

`original/provenance.json` pins the original `3a9177a` source, README and rmdir
tests, copied verbatim into `original/committed/` as text. It also records exact
hashes and origins for the independent reviewer's manifests, runner, probe and
raw before/after observations from
`/tmp/safe-bash-overlay-rmdir-3a9177a-AGvOuU/`.

`original/reviewer-REPORT.md` is the exact final independent report; its separate
provenance file records its origin and hash. The reviewer's short final message
lacks a terminal newline and is retained byte-exactly as base64 in
`original/reviewer-final.base64`; its decoded source hash and encoding are in
`new/manifest.json`. No original report or source expectation has been rewritten.

The original independent probe exits 0 because its **11 observations** assert
the old behavior, not because the four unjustified static ENOTSUP outcomes are
accepted. Static lower-only, preexisting upper-only, merged-empty, and logically
empty after individually whiteouting a lower child are the four rejected valid
cases. The reviewer also confirmed nonempty preservation and same-instance
queue ordering. Its archive/source hashes remain in the preserved manifests.

## Explicit expectation correction

The two former `overlay live lower directory, merged=...` tests changed lower
directly during a directory listing. That violates the existing unchanged-lower
precondition and cannot justify blanket refusal for valid static storage. They
are replaced by exact static success expectations for lower-only and merged
directories: public and upper paths become ENOENT, the remaining public listing
is exact, every lower entry/byte is unchanged, and lower mutation traps remain
empty. There is no `ENOTSUP|success` alternative or weakened error matcher.

The former `overlay cannot infer immutable lower storage ...` test likewise
modified lower externally after its refusal. Its replacement seeds the upper
directory and lower sibling before construction, requires successful removal,
checks exact absence and lower preservation, then recreates and writes through
the same overlay while preserving all lower bytes and namespace.

All original versions are retained verbatim. The revised tests and eight new
focused regressions were first run against the unchanged old source:
**14 pass, 9 fail / 23**, exit 1. `original/new-expectations-before-fix.*` pins
that source and test hashes and preserves all failures. The same expectations
then pass against the corrected source; they were not adjusted after the fix
to manufacture acceptance.

## Preserved protections and scope

- Exact lower snapshots include file bytes and all namespace entries, including
  hidden descendants and siblings. Only read-side atime is excluded, consistent
  with the existing backend-read limitation.
- Whiteouted lower children remain physically intact and do not reappear when
  the directory is recreated through the overlay; new children live in upper.
- A same-instance child queued first is preserved with ENOTEMPTY. A child queued
  behind successful removal sees ENOENT, or succeeds if parent recreation is
  queued first. Lower storage remains unchanged in both cases.
- Missing upper rmdir still gives ENOTSUP when an upper entry needs deletion.
  Lower-only whiteout removal requires no such unused primitive or parent copy-up.
- A physically nonempty upper whose listing hides a child propagates the backing
  ENOTEMPTY, preserves that child and directory, and publishes no whiteout.
- Existing cancellation, readonly, exact-error, final-symlink, protected-root,
  injected upper-failure and no-recursive-garbage-cleanup controls remain active.

External lower mutation is outside the documented lifetime guarantee. This fix
does not promise undo, snapshots, global atomicity, or coordination with such
writers. Physical upper deletion still relies on its safe backing primitive.

## Validation and pending alias requirements

`new/manifest.json` records commands, entrypoints, test/source SHA-256 inventories
before and after, statuses, counts and output hashes. Source hashes remained
stable throughout. All captures and original copies were hash/byte verified.

| Gate | Pass | Fail | Total |
| --- | ---: | ---: | ---: |
| Focused overlay rmdir | 23 | 0 | 23 |
| Complete overlay tests | 182 | 2 | 184 |
| Included required-red overlay alias cohort | 5 | 2 | 7 |
| Unchanged shared conformance | 202 | 0 | 202 |

Strict scoped TypeScript `--noEmit` passes. All tests have zero skips, TODOs and
cancellations. The complete overlay gate remains exit 1 solely for the two
previously recorded upper/lower hardlink copy-identity guards; they are not
rmdir regressions and are not waived or removed from the denominator. The
identity seam remains unapproved and was not invented or awaited. No unrelated
full filesystem, command, shell, or global typecheck suite was run.

This is the author's fixed-revision checkpoint, not independent fixed-revision
acceptance. The read-only reviewer will receive the atomic commit hash for its
own rerun. Only overlay source/documentation and matching tests/evidence changed.
