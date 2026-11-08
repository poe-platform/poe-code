# Static review of frozen final source

Read the final author handoff, exact committed tree delta from `e2d1b923`, the
six tree modules, and shared identity helper in the immutable snapshot. Review
is not a new execution of the peer's separately sealed six-case safety corpus.

- `pattern.ts` remains finite byte-token dynamic programming, not generated
  RegExp. Compilation charges cumulative admitted source work before encoding
  and structures; each alternative charges work; empty alternatives avoid a DP
  row; nonempty initial and transition rows reserve work before allocation.
  Bracket membership reserves range scans. All share the invocation WalkBudget.
- `tree.ts` reserves `1 + left.bytes.length + right.bytes.length` before every
  byte comparison; the `--dirsfirst` second comparator now calls `step()` too.
  This is conservative work accounting, not CPU/RSS or comparator-byte telemetry.
- Argument, metadata and output admission checks UTF-16 length lower bounds
  before UTF-8 sizing. Raw Error.message admission precedes prefix removal;
  opaque non-string exceptions avoid arbitrary conversion. Backend creation of
  strings and host getters remain outside the command's control.
- Escaping checks each expanded part before append; JSON field/escape sizing
  precedes stringify and bounded fixed-class replacement. The complete formatted
  write is also admitted. A bounded set of fragments can coexist; this is not a
  zero-allocation or exact peak-memory guarantee.
- Tree modules use supplied VFS metadata only: no content read, implicit host FS,
  subprocess, network, runtime package or new executor/worker import. The sole
  direct Node import is cooperative timer yielding. Rooted real FS and Node
  subprocesses in this evidence belong to the harness, not virtual tree.
- Cycle comparison calls the existing scoped identity/compareEntry helper;
  unknown stays unknown and no realpath string becomes namespace authority.
  Ancestor-only traversal is our bounded chosen profile, not a literal user
  instruction. Unknown/malformed host contracts remain characterizations.
- FS promises race abort and retain rejection observation; sinks use awaited
  `writeBytes` with signal, preserving backpressure and owned byte chunks.
  Original pending FS/sink late-error, errno cancellation, partial-output and
  low entry/output cap probes passed unchanged on this final source.
- No new invocation-owned acquisition was introduced by the tree delta. These
  direct cancellation checks do not establish every public Shell cleanup case.
  A37 did run actual Shell pipeline/subshell/redirection/JSON consumer/disposal.

The observed source closure changed five files from initial38: four tree modules
and `src/shell/shell.ts`. The latter is an independently committed plugin-host
admission/disposal change, frozen here rather than aliased to live source; its
delta is retained separately. No outside-core failure is demonstrated or fixed.

Limits remain backend materialization/opaque host work, finite declared formats,
no deployed provider claim, no complete native parity/performance/full gate, and
no source acceptance decision for the separately owned safety-six-case suite.
