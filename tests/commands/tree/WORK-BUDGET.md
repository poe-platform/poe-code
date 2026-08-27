# TREE-WORK-001: cumulative finite-DP accounting

This is an author fix candidate for independent verification, not a full gate
or public/default integration. The author read only the routed static finding
at `/tmp/safe-bash-inspection-safety-peer-root-route.txt`, not hidden holdouts.
Ownership remains `src/commands/tree/**` and `tests/commands/tree/**`.

## Original failure, reproduced before the final fix

The original source is commit `e2d1b9230f4304650651572395523ca9d1644e74`:

- `pattern.ts` SHA256:
  `6209978bbd3cbfd171eab7cd63aca95414b757ebc2151317835f8ee4166d0121`.
- `arguments.ts` SHA256:
  `0b3d8ef78852d0d7623eb0286202bcfec44590906a9fa8892bc51376904bfce3`.

For each alternative, the old matcher allocated a `name.length + 1` DP row
before its token loop. Empty alternatives had no tokens and therefore no
`budget.step` calls at all. This was a **finite-DP accounting defect**, not
RegExp backtracking or an unbounded regex engine.

The independently constructed regression uses only 32 distinct 32-byte names
and 15 pipes (16 empty alternatives). A synchronous test-local constructor
probe measures numeric `Uint8Array` row allocations during `matches` only;
the original constructor is restored in `finally`, with no awaited work inside
that measurement. It measures logical zero-filled row bytes, not heap/RSS,
allocator overhead, live retained memory or execution time.

| Bounded observation | Original | Fixed |
| --- | ---: | ---: |
| Compilation work units | 0 | 47 |
| Matching work units over all 32 names | 0 | 512 |
| Measured DP row allocations | 512 | 0 |
| Measured DP row bytes | 16896 | 0 |
| Actual Shell, 32 entries, `maxSteps: 256` | Incorrect status 0 | Status 1, work-limit diagnostic, empty stdout |

The old initialization formula `32 × 16 × (32 + 1) = 16896` agrees with the
small measured constructor total. The route's larger `128 × 4096 × 513 =
268959744` bytes was **theoretical and not executed**. No large allocation,
runaway workload or benchmark was used to reproduce or validate this fix.
Direct compilation/matching phase counters are measured separately; the Shell
test checks the real shared invocation budget, including existing walk costs.
A single-entry control passes at the same limit for both `-P` and `-I`, whereas
the many-entry cases fail. The defect is not hidden by a per-entry budget reset.

### Retained failure history

`work-budget-original.tap` preserves the first pre-edit run: both regressions
failed, including measured zero work and 512 allocated rows. Its Shell assertion
incorrectly expected a rejected promise rather than the current runtime's
status-1 handling of non-abort EFBIG. The source fix initially made the direct
counter test pass while that incorrect integration assertion still failed;
`work-budget-initial-fix.tap` retains that 5-pass/2-fail run rather than hiding it.

The author corrected only the new integration assertions to check current
Shell status, stdout and diagnostic. The two owned implementation files were
then restored byte-for-byte to the original hashes above, and the two regression
tests rerun before reapplying the final fix. The definitive original replay is
`work-budget-original-corrected.tap`: actual matching work was `0` instead of
`512`, and actual Shell status was `0` instead of `1`. The bounded fixture and
input sizes were unchanged. Existing tree/native tests were not rewritten.
The two original TAP files are byte-for-byte copies of their captured logs,
including six whitespace-only assertion-formatting lines flagged by
`git diff --check`. Those raw evidence bytes are intentionally retained; the
implementation, regression, documentation and manifest pass the whitespace check.

## Minimal fix and exact limits profile

Only two implementation files change: the existing argument parser passes its
`WalkBudget` into compilation, and the finite matcher/compiler charges work.
There is no new public API, worker, timer, queue, subprocess or shared executor.
The default `maxSteps` stays 4194304; budget exhaustion is intentionally stricter
because previously uncharged compilation and row work now counts.

- Compilation reserves UTF-16 source length plus one before its fixed linear
  validation scans, then UTF-8 length plus one before encoding/initial arrays.
  Each outer parser iteration and bracket-range iteration also charges before
  creating its token, alternative or range. A metered unit covers a bounded
  amount of work, not one CPU instruction or allocator byte.
- Every attempted alternative charges one unit. Empty alternatives still match
  an empty name and reject nonempty names, but do so without allocating a DP row.
  Their order, union behavior and interactions with nonempty alternatives are
  unchanged; they are neither rejected nor silently normalized away.
- A nonempty alternative charges the initial `name byte length + 1` row cells
  before allocation. Each token charges twice that row length before allocation
  and evaluation, separately accounting for initialization and transition work.
  Existing bracket-range evaluation charges remain conservative.
- All compilation, patterns, alternatives and names consume the same command
  budget. Neither compilation nor matching constructs or resets a budget.

The 32-byte-name/one-token control measures two rows (66 bytes) and 100 admitted
units: `1 + 33 + 2 × 33`. With cap 1, the initial row is rejected before any
allocation; with cap 99, the second row is rejected after only the first 33-byte
row. Attempted work charges can exceed the cap in the rejected batch; this does
not imply that rejected rows were allocated or rejected transitions executed.

## Constant-regex and parser inspection

The matcher/compiler does not construct or execute a user-supplied RegExp.
Its token and bracket loops monotonically advance through bounded source bytes;
the new work charges include skipped bytes in the source/encoding reservations
and each parser/range iteration. `-P`/`-I` compile once per flag, not once per name.

The surrounding constant patterns were inspected: isolated-surrogate detection
and JSON/control escaping are single-character classes; numeric depth validation
is anchored digits; diagnostic prefix stripping is anchored uppercase text with
a delimiter; trailing-slash removal is fixed-width. None has nested ambiguous
repetition or constructs regex syntax from filenames/patterns. These fixed scans
remain bounded by argument/metadata/path caps; they are not claimed as exact
CPU-time metering. No shared regex, core, FS, contract or lifecycle code changes
are needed for this finite-DP defect.

## Validation and freeze

- Seven new regressions pass, including direct allocation/work counters,
  pre-allocation rejection, compilation/range accounting, repeated-pattern and
  repeated-name accumulation, empty-name/union/wildcard semantics, and actual
  Shell single-/many-entry include/exclude controls. See `work-budget-fixed.tap`.
- The unchanged original 58 tests plus these seven pass: **65/65**, zero failed,
  skipped, cancelled or TODO. Pinned native replay is enabled, retaining the
  original 24 exact and four JSON-semantic comparisons and six explicit native
  divergence captures. No old fixture/expected output was relaxed.
- `node_modules/.bin/tsc --noEmit -p tests/commands/tree/tsconfig.json` passes.
- The owned scoped build config emits ESM/declarations to isolated
  `/tmp/safe-bash-tree-work-build-N7Eqdd`, not live `dist`. A strict NodeNext typed
  consumer of the existing standalone factories/types compiles and runs against
  emitted ESM with actual Shell, verifying the many-entry cap. This is not root
  package/subpath consumer evidence.
- `work-budget-source-manifest.json` records the final bounded test invocation's
  loaded source/test hashes. It is a source-stability snapshot, not a clean
  whole-repository gate or acceptance by the different verifier.

Original native fixture SHA256 remains
`a7c312188244ff48760b4a6b247983d2ffa66bcffd6072d67e63acd1f074a3ab`;
the unchanged tree 2.2.1 Darwin arm64 C/ASCII oracle binary remains
`34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a`.
There are no active workers or acquired worker resources to clean up. Test-local
constructor instrumentation is restored, all Shell instances are disposed, and
native/real per-run fixtures use the existing cleanup. Independent verification
of the committed final-source freeze remains required.
