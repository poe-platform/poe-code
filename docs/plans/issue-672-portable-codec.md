# Issue 672: portable compression and archive codecs

## Ownership and contract

This worker owns only compression `stream.ts`, `gunzip.ts`, `errors.ts`, new
`codec.ts`, archive `stream.ts`, their existing focused test directories and this
plan. Root owns pako 3.0.1 installation, dependency declarations, packaging and
final public-runtime acceptance. The random worker owns compression `files.ts`;
its transaction implementation and the `transform`/`compressed` signatures stay
unchanged. No Git operations, full builds, repository lint or README edits here.

Replace Node zlib/stream machinery with pako's public low-level API. Preserve
levels, headers, checksums, concatenated members, CLI force/warning behavior,
the distinct archive trailing-data policy, all existing byte limits, owned
output, backpressure, original cancellation identities and retirement ordering.
No high-level codec accumulation, native CompressionStream, or whole-input
fallback. Keep native Node imports confined to test oracles.

## Evidence before implementation

- The isolated pinned-pako probe passed 45/45 cases on Node v22.22.0:
  `/tmp/kamilio-672-pako-proof.uUpIBA/proof.json`. It verifies exact unused raw
  input at member boundaries, capped slabs, cancellation/return cleanup and
  active-deflater `Z_DATA_ERROR` cleanup without retained codec state. It is not
  browser or asynchronous-I/O acceptance.
- The new regression in existing compression `behavior.test.ts` builds the
  actual compression/archive source graph with the existing browser platform
  wiring and no Node codec/stream externals. Before product edits it fails on
  five Node import edges. Detailed RED evidence:
  `/tmp/kamilio-672-codec-browser-red-detail.log`.
- The first attempted patch used a duplicated working-directory prefix and
  failed without changing a file. Its subsequent empty name-filter run is not
  RED/GREEN evidence. The correctly applied named test above reproduces RED.

## Implementation sequence

1. Add a pull-based low-level driver with at most 64 KiB input/output work slabs,
   explicit event-loop checkpoints including no-output work, exact unread input,
   finalization and deterministic state release.
2. Replace raw inflation under the existing CLI header/footer/member parser.
   Preserve FHCRC, CRC-32, ISIZE, forced passthrough and warning statuses.
3. Replace the compression pipeline while keeping consumption-completeness and
   VFS-writer retirement before staging cleanup. Observe admitted producer
   failures without continuing codec work while the consumer is blocked.
4. Reuse the driver for archive gzip, preserving its native-style concatenation,
   zero-padding/trailing behavior and compressed/decompressed archive limits.
5. Run only focused compression/archive regressions and report exact results.
   Root separately verifies packaged Node/Bun/browser/workerd behavior and the
   complete portable command inventory.

## Required focused acceptance

- Existing behavioral, streaming, safety, archive lifecycle and native-oracle
  cases remain green; every existing level, alias and file-staging option stays.
- Single-byte header/block/footer/member partitions preserve exact bytes;
  invalid FHCRC/CRC/ISIZE and truncated input retain their diagnostics/status.
- Codec/source work stops at downstream backpressure. Pre/mid abort, early
  consumer return, blocked and late-failing producers/sinks, mutable producer
  buffers and incomplete VFS consumers preserve cleanup/error precedence.
- Existing staging/archive caps reject expansion before the violating output
  is published. Empty chunks and long no-output/header work remain cancellable.
- The codec browser graph becomes green without Node codec/stream shims.

## Status

Implementation frozen for root integration on September 8, 2026. No remaining
known product edit is required within this worker's scope.

### Implemented bounds and ownership

- The shared driver uses only Pako low-level state APIs. Input admitted to a
  codec call and output slabs are capped at 64 KiB; output is not accumulated
  across slabs. Calls yield a task after 64 calls or 64 KiB of consumed/produced
  work, including calls producing nothing. Invalid slab sizes fail before input
  acquisition. State is ended on completion, error and generator return; active
  `deflateEnd` returning `Z_DATA_ERROR` does not replace the original failure.
- Raw inflate restores the entire unused current-input suffix to the existing
  CLI input reader before footer parsing. That reader continues to validate
  FHCRC, CRC, ISIZE and concatenated members and retains CLI-only force/warning
  behavior. Archive decoding instead retains native-style member reset and
  zero-padding/trailing-error policy. Existing archive and staging budgets stay.
- CLI input is copied into owned, bounded slabs before advancing a borrowed
  producer buffer. One next source read is admitted before yielding the last
  slab of its previous chunk, so an already-admitted producer failure can abort
  a blocked sink. No further pulls or codec work begin while output is blocked.
  Partial output waits at most one event-loop turn for an admitted input read
  before being yielded; the losing scheduling handle is cancelled.
- Callers own source retirement. They abort their local linked signal before
  returning readers. Transform still requires complete consumption and awaits
  the VFS consumer's retirement before its caller removes staged output.

### Evidence

- Browser graph RED: `/tmp/kamilio-672-codec-browser-red-detail.log` records five
  unresolved Node codec/stream edges. The same in-memory esbuild regression now
  passes without codec/stream aliases or externals. Canonical safe-fs remains an
  explicit graph boundary, not a claim of complete browser-runtime acceptance.
- Invalid-slab RED: `/tmp/kamilio-672-codec-options-red.log`; the regression now
  passes before source acquisition.
- GREEN: `/tmp/kamilio-672-codec-all-focused.log`, exit 0, **239/239** tests, zero
  skipped/cancelled/failed. Command, from `packages/safe-bash`:
  `node --import tsx --test --experimental-test-isolation=none tests/commands/bytes/compression/*.test.ts tests/commands/archive/*.test.ts`.
  This includes 36 raw-footer/remainder partition combinations, all nine levels
  against a native oracle, archive trailing/member policy, no-output task
  cancellation identity, borrowed-buffer reuse and strict blocked-sink pull
  counts. Existing lifecycle, staging, early-consumer and safety tests remain.
- `/tmp/kamilio-672-codec-types.log`: TypeScript 5.9.3, six owned changed source
  and test files checked, zero diagnostics in those files. This filtered check
  is not a repository typecheck or substitute for root's maintained gates.
- Earlier failed/intermediate logs remain intact. The transient archive import
  failure was resolved by root's bridge integration, not a worker scope change.

### Remaining integration risk

Root owns full build/types/lint/tests and actual installed browser/workerd/Node/
Bun acceptance. The fixed Pako implementation can differ from another native
zlib release's compressed byte choices for other inputs, although the required
format/options and tested native-oracle payloads match. A source whose already
admitted `next()` or `return()` ignores cancellation cannot be forcibly stopped;
late rejection is observed, and the existing reader cancellation contract is
preserved. No full suite, package manifest, build script or Git operation was
performed by this worker.

### Cross-interface error-identity correction

Root's full suite subsequently exposed an omitted cross-interface case:
`tests/shell/opaque-errors.test.ts` rejected an archive source with `undefined`,
but received the default `AbortError` manufactured by `abort(undefined)`.
The unchanged focused regression reproduced this failure in
`/tmp/kamilio-672-codec-undefined-red.log`. Archive compression now records the
first original failure with a separate presence flag before aborting its local
controller, and rethrows that value after cancellation/retirement propagation.
This preserves `undefined` and every other falsey value without truthiness
fallbacks; explicit parent cancellation retains precedence.

Revalidation: `/tmp/kamilio-672-codec-undefined-green.log`, exit 0, **360/360**
tests (all 239 compression/archive cases plus the complete opaque-errors file),
zero failed/skipped/cancelled. Existing error-identity assertions are unchanged.
`/tmp/kamilio-672-codec-undefined-types.log` reports TypeScript 5.9.3, seven scoped
files, zero scoped diagnostics. Only archive implementation and this handoff
document changed for the correction. Frozen again for root package admission.
