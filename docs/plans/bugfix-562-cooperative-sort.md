# #562: cooperative byte-oriented sort

## Scope and evidence

- Base: main `86dc63e08`; September 4, 2026.
- Own only `packages/safe-bash/src/commands/text.ts`, existing
  `packages/safe-bash/tests/commands/text.test.ts`, and this plan.
- Prior source-only validation confirmed synchronous whole-array sorting, repeated
  folding/key extraction and numeric-cache-hit cancellation gaps. For 256 records,
  default/fold sorting performed 1,556 comparisons; ordinary keyed sorting 1,729.
  A queued microtask could not run during the native sort. Historical elapsed-time
  and RSS claims are not accepted as current evidence.

## Implementation and TDD

1. RED: deterministic registered checkpoint tests for comparison/move batching,
   queued false/null cancellation, warmed numeric caches and long records; no
   stdout/stderr publication or destination replacement on sorting cancellation.
2. Replace native whole-array sorting with stable iterative merging. Charge record
   moves and comparisons toward a cooperative batch, not a hard total-work cap.
3. Account byte-intensive preparation and checkpoint owned JavaScript scans;
   preserve raw bytes, ASCII folding, exact numeric grammar, key-local flags,
   stable/unique/reverse behavior and the existing bounded numeric caches.
4. GREEN: run the assigned test file and adjacent core-sort semantic/ownership
   regressions and native-oracle coverage. Use package-local Node 22 types for
   scoped type evidence; no builds, broad gates, registry/README edits or Git writes.

## Limits

Cooperation does not preempt individual native allocation, regex, conversion or
string operations, nor provide wall-clock/RSS guarantees. Stable merging needs
linear scratch references. No new locale/version-sort features or public API.
Root owns integration and release; the separate yq work is untouched.

The implementation uses a 4,096-unit cooperative batch, counting comparisons,
record moves and byte preparation; this is not a hard total-work limit. Owned
folding, blank/field scans and byte/numeric comparisons use at most 1,024-byte
scan/comparison chunks. Numeric normalization retains its existing native
regex/conversion operations, preceded by source-byte work accounting; those
individual native operations remain unpreemptible. Cached numeric descriptors
retain their original 16,384-entry and 1 MiB accounting guards. Check mode and
unique filtering await the same comparison path. No output is published before
sorting completes; later output cancellation does not roll back prior writes.

## Results

- RED: the existing text test file reported 4 failed checkpoint/cancellation
  groups and 5 passing semantic groups. The old implementation had zero batching
  checkpoints and fulfilled operations that should reject queued cancellation.
- GREEN: 94 tests passed, zero failed/skipped/cancelled, across exactly:
  - `tests/commands/text.test.ts`
  - `tests/commands/core-sort/unkeyed-numeric-cache.test.ts`
  - `tests/commands/core-sort/single-numeric-key-cache.test.ts`
  - `tests/commands/core-sort/regressions.test.ts`
  - `tests/commands/core-sort/borrowed-buffer.test.ts`
- The cohort includes 35 frozen GNU 9.7 byte-equality cases at two input chunk
  widths, bounded numeric-cache saturation, raw-byte ownership, stable/unique/
  reverse/key semantics, backpressure and output replacement. Frozen oracle
  comparisons are not a new native capture or universal GNU parity claim.
- New tests cover host-turn queued false/null cancellation, warmed descriptors,
  long records, unchanged destinations and no stdout/stderr on sort cancellation.
  The empty-record fixture independently requires comparison and move accounting
  without byte-work credit and bounds checkpoint counts to retain batching.
- Final no-emit TypeScript check: roots are only the two owned TypeScript files
  plus their transitive dependencies; zero diagnostics. Node `22.22.0`,
  TypeScript `5.9.3`, package-local `@types/node` `22.20.1`, with the resolved Node
  type path checked explicitly. This is not the repository-wide type gate.
- All test children clear `git rev-parse --local-env-vars`, unset `NO_COLOR`, use
  `TSX_DISABLE_CACHE=1`, and read the prescribed toolchain/TMPDIR pointer files.
  Invocation from `packages/safe-bash`: `node --import tsx --test
  --test-concurrency=1` followed by the five literal test paths above.
- Private evidence directory: `/var/tmp/poe-code-kamilio-560-final.Fqmapg`.
  RED: `562-red.tap`; final GREEN: `562-final-green.tap`; final scoped types:
  `562-final-types.txt`. Earlier intermediate GREEN/type outputs remain there.
- Guarded repository lint has no maintained two-file CLI selection; broad lint
  and build/release gates remain with root. No build, broad gate, stage, commit,
  push, shared registry or README change was performed.
