# Issue 676: bounded GNU 8.30 shuf preparation

## Root integration checkpoint, September 9, 2026

- Before registration, all three new public-registration tests fail with status
  127 and command-not-found. Receipt: `/tmp/shuf-676-registration-red.log`.
  Register `shuf` after `fmt`; synchronize the exact independently declared
  85-command inventories, custom replacement counts and family offsets, without
  changing sealed historical fixtures. Both shuf test paths are explicitly
  covered by maintained integration-input discovery assertions.
- Root's normal workspace build passes. After it completes, all 1,728 focused
  Node tests pass without skips, including the complete shuf and fmt suites,
  registration and every modified Bash inventory. All 75 tests in the four
  affected playground/bundle/package Vitest files pass. Receipts:
  `/tmp/kamilio-676-integration-build-v1.log`,
  `/tmp/kamilio-676-postbuild-focused.log`, and
  `/tmp/kamilio-676-consumer-tests.log`.
- Full maintained lint passes: 10,436 configured subjects, zero errors/warnings,
  plus root types and workflow lint. Receipt:
  `/tmp/kamilio-676-integration-lint-v1.log`.
- Final independent review reports no reproduced blocking finding. Separate
  overlapping cohorts pass 2,126 prior comparisons, 224 zero-range comparisons,
  288 fresh positional-quoting comparisons, and 72 native/public-source-entry
  comparisons. Eight input lifecycle, ten output capability, eighteen falsey
  failure and three zero-allocation controls pass. Review and raw evidence:
  `/tmp/shuf-676-final-independent-liIO7s/review.md`. These are not a count of
  distinct inputs or proof about every native profile.
- The shared installed-consumer fixture exercises default and Node entries in
  Node/Bun and is invoked by the browser fixture. It includes literal/nested
  execution, VFS and pipe inputs, output-file overwrite, ranges, binary NUL
  records, GNU's sparse duplicate edge case, no-work huge ranges and exact
  apostrophe/question-mark/leading-hash diagnostics. Its reviewed SHA-256 is
  `68639a8eec8fd3933cd8f07b8786179e48da7c26dc4ba71382fc2fe65c0a701c`.
- Inspected `/tmp/kamilio-676-playground-shuf.png` from the real playground.
  Its full command transcript matches native stdout/error/status recorded in
  `/tmp/kamilio-676-visual-native.json`. Seeded output, sparse behavior,
  zero-count status and errors render clearly. The task-only browser was closed
  and confirmed absent; its Vite server was stopped.
- Local preparation remains ordered after cmp and fmt. External push/closure
  approval is still pending, and final committed artifact/full-unit gates remain
  separate pending checks. No remote delivery or release is claimed.

## Ownership and checkpoint

September 9, 2026. Prepare only `packages/safe-bash/src/commands/shuf.ts`,
`packages/safe-bash/tests/commands/shuf*.test.ts`, their `shuf*.snapshot.json`
evidence, and this document. No command registration, inventories, shared
contracts, README edits, staging, commits, pushes, issue closure, or release
actions are authorized. Root owns integration and delivery independently.

The original missing implementation was confirmed by source search and an
`ERR_MODULE_NOT_FOUND` failing test before implementation. Preparation remains
unregistered; explicit `CommandRegistry([shufCommand()])` composition is tested.

## Original source and native binding

Read all 610 lines of GNU coreutils 8.30 `src/shuf.c`, matching installed
`shuf (GNU coreutils) 8.30` on Linux x86-64 / glibc 2.31. The original utility is
at `/tmp/kamilio-676-gnu-shuf-8.30.c`. Read the complete random-selection helpers
`randperm.c` (237 lines), `randint.c` (216), `randread.c` (347), and their headers;
also read `rand-isaac.c`/`.h`, `linebuffer.c`, `xstrtol.c`, and `xdectoint.c`.
Inspected the quoting/locale branches in `quotearg.c` for diagnostic repairs.
Do not describe the virtual implementation as the GNU executable.

Sources were extracted from `/tmp/fmt-675-coreutils-8.30.tar.xz` into
`/tmp/shuf-676-original/coreutils-8.30/lib/`. The archive SHA-256 is
`e831b3a86091496cdba720411f9748de81507798f6130adeaef872d206e1b057`;
its `src/shuf.c` bytes match the separately retained original.

| Source | SHA-256 |
| --- | --- |
| shuf.c | `08b7d847601d98c0087f2e144a04bec30a67fc4276aba1075804a48c11127c88` |
| randperm.c | `47212e7497524cc884b787004b114f71ef7ade6ff87d0f19a31e25de7df7358b` |
| randint.c | `0d39ced9ab5fc9fc07c30e4ddef1da0bf120736076350685eb52d87bdd88b4d4` |
| randread.c | `2166e819015714f053693f9fc9f3e7ff0cf0169707b30a4990f41619dfc8c8a4` |
| rand-isaac.c | `3435e436a14bf5e267b4be6448dadf91dc0c6c214de8b91d405050f5abbfa88d` |
| quotearg.c | `9b644b6e9d83e8293d6800f33e8c0ff67b764eb948a4e67f0be76b0aab4f5eea` |

The independent oracle records native executable SHA-256
`bf3ba9e17369424ba8e6e82833686a2e64b9a7d794cda5b61f206bab4a16bdde`.
UTF-8 diagnostic printability uses the same pinned glibc 2.31 scalar ranges
as the fmt preparation. The native `iswprint` capture source is
`/tmp/fmt-675-printable.c`; `/tmp/fmt-675-printable.json` SHA-256 is
`6519a54fb6605ccc4d87f953fce1d333afc35668ace7b63bc50fc8b38e5b89ae`.
This is locale data, not a dependency on native code at runtime.

## Source-to-runtime comparison

- Parse GNU short clusters, long-option abbreviations, `--`, option permutation,
  `POSIXLY_CORRECT`, `-e`, `-i`, `-n`, `-r`, `-o`, `-z`, and `--random-source`.
  Repeated `-n` takes the minimum; overflow is ignored. GNU 8.30 deliberately
  accepts suffixes after the numeric prefix for `-n`. Repeated `-i` fails;
  identical repeated output/random-source paths are accepted.
- Parse range endpoints as unsigned 64-bit integers. An adjacent reversed range
  is empty; other reversed/overflowing ranges fail. Overflow combined with an
  invalid suffix omits the overflow strerror, as in `xdectoint.c`.
- Preserve byte argv rather than recovering bytes from display strings. Admit
  plain UTF-8 argv before carrier creation, and preowned argv by actual owned
  byte lengths before materialization. Invalid UTF-8 paths never alias a valid
  replacement-character VFS name.
- Derive filename quoting from `quotearg.c`'s separate shell-special and
  C/shell-compatible character classes. Question marks prohibit the apostrophe
  double-quote shortcut. Initial `#`/`~` are C/shell-compatible through the source's
  space-case fallthrough; later occurrences are not. Braces fall through only
  when isolated. These positional rules are not a universal exclusion string.
- Preserve input record bytes, duplicates, NUL delimiters, and synthetic final
  delimiters. Named input opens through the VFS; omitted FILE and `-` use stdin.
  Output `-` and random-source `-` are literal VFS filenames, not stdout/stdin.
- Preserve the source's zero-count sequencing: file-open bypass, nonrepeat
  reservoir random-source admission without stdin consumption, and repeat input
  consumption before random-source admission. Echo/range zero random-byte bounds
  do not open a random source or acquire default entropy. The six independent
  throwing-entropy-hook regressions now succeed without calling the hook.
- For zero selections, return empty permutation storage before cardinality-sized
  allocation, as in `randperm_new`'s `h == 0` branch. A parsed zero count bypasses
  range-cardinality admission, not parsing, random-source admission, or output
  processing. Repeat mode still admits its random source (or seeds its default
  generator) before output creation/truncation. Nonzero-selection caps remain.
- For finite-count nonrepeat input, use reservoir sampling for nonseekable input
  or retained regular-file input larger than 8 MiB; preserve the extra random
  selection before the EOF probe after filling the reservoir. Shared stdin
  metadata/position/seekability is consumed through `CommandInput`.
- Preserve GNU's buffered random-integer reduction/rejection algorithm for the
  bounded domains. Exact random output comparisons use the same VFS random-source
  bytes, input/seekability profile, and selection path. Default entropy seeds an
  invocation-local xoshiro128** generator via `crypto.getRandomValues`, not GNU's
  ISAAC64 generator. Never claim identical default random values or cryptographic
  suitability of the PRNG.
- Finish input and nonrepeat selection before opening `-o`, permitting input/output
  aliases. In repeat mode, output opens before random sampling; empty positive
  repeat fails after output admission, while zero repeat succeeds. Retain native
  random-source exhaustion and output/random-source alias sequencing.
- Use locale-appropriate C/UTF-8 quotes while preserving invalid bytes, rather
  than UTF-8 re-encoding a lossy diagnostic string. Help/version intentionally
  identify the virtual command instead of reproducing GNU branding.

### Pinned sparse mapped self-swap quirk

GNU 8.30 switches to sparse permutation storage when `n >= 131072`, `h > 1`,
and integer `n / h >= 32`. Its sparse mapped self-swap can replace the mapped
value with its own index. Exact random bytes `00 00 01 00 00` with
`-i0-131071 -n2 --random-source=rng` produce `1\n1\n`, not a permutation.
Seed `00 00 02` followed by zeros can produce `2\n1\n2\n`.

The bounded dense index array models this observable self-swap result only in
the native sparse branch. It does not copy the C allocation/leak behavior or
perform unsafe memory operations. Tests pin the threshold, ratio, singleton,
dense, unmapped-self-swap, mapped-third-entry, and exhausted-source controls.
Permutation/statistical invariants are scoped to branches where GNU preserves
them; there is no unconditional no-duplicates/permutation claim.

## Resource and cancellation boundaries

No new public configuration is exposed. Fixed limits are 4096 argv entries and
64 KiB argv bytes; 32 MiB input bytes per input/random reader; 1,048,576 input
records, nonzero-selection range cardinality, and repeated output records; 32 MiB output bytes;
4 MiB consumed random bytes; 4096 consecutive empty chunks; and 4096 rejection
attempts per selection. Unbounded `-r` without a finite admitted count is rejected.
Large endpoint magnitudes remain exact when the range cardinality is admitted.
These intentional sandbox limits differ from unbounded native execution.
Zero-count ranges need no cardinality-sized storage and are not subject to the
range cap. The earlier classification of the four such mismatches as inherent
resource-limit differences was incorrect and is withdrawn. Keeping the cap for
nonzero selections is a separate implementation boundary, unchanged by this fix;
it is not a claim that every GNU selection over a large range requires dense
storage.

Use existing `ByteInputBudget`, `RecordBuffer`, byte argv, filesystem requirement,
`writeBytes`, `CommandInput`, `yieldTurn`, and `createOutputOperation` contracts.
Copy retained producer bytes before advancing/retiring a reusable buffer. Bound
metadata by record/range caps and yield during chunk reads, byte scans, random
rejection, selection, and output. Backpressure is awaited.

Register cleanup before owned acquisitions. Input scopes await admitted retained
open/stat/read work and retire handles/iterators once. Opaque pathname capabilities
and fallback pathname stat run before owned acquisition tracking. Recheck the
signal after each metadata query; publish the owned pending operation before
calling the reader provider, including reentrant opens. Cleanup publishes its
idempotent completion promise before synchronously closing local admission, so a
late metadata resolution/rejection cannot open a reader. Output acquisitions drain
through their output operation. Explicit completion outcomes preserve falsey
primary/cancellation/cleanup identities without a control-flow throw in `finally`.
Closing stdout must not cancel independent `-o` work.

The independent output-capability cleanup-barrier finding was explicitly
withdrawn. An opaque `capabilitiesFor` promise is not automatically an owned
resource acquisition. Keep output admission permanently closed, check the signal
after the query, and drain already admitted writes; do not await all opaque
metadata promises. The ten-case reassessment and late-write controls remain
separate from the original overstrong barrier expectation.

The later `/tmp/shuf-676-reverify-Yffwl4/review.md` also withdraws the prior
assertion that waiting for input capability metadata was correct. That assertion
encoded an overstrong barrier, not valid clearance: public `Shell.exec` and
`Shell.dispose` must settle on `abort(false)` before metadata resolves when no
reader exists. Both historical input/output metadata-drain expectations are now
excluded; all original captures remain preserved. Real retained acquisition,
handle stat/read, reentrant acquisition, and producer-retirement barriers remain.

## TDD and retained evidence

- Initial missing-module red preceded implementation; the first green checkpoint
  contained 17 tests and 147 immutable native comparisons after byte-admission and
  retained-read cancellation repairs.
- `/tmp/shuf-676-independent/review.md` records 174 comparisons, 16 diagnostic
  comparisons, lifecycle captures, the paced-pipe control, and the explicit
  capability-barrier withdrawal. All original failed captures remain unchanged.
- `/tmp/shuf-676-repair-red.tap`: 133 tests, 20 failures reproducing sparse output,
  UTF-8 diagnostics, invalid-suffix overflow, and six zero-entropy admissions.
  `/tmp/shuf-676-repair-green.tap`: all 133 pass after their repairs and structural
  lint fixes. No rule suppressions were added.
- The 666-case external raw-argv review uses Python byte `execve`, not a shell
  that changes locale during startup. Preserve earlier contaminated captures
  `/tmp/shuf-676-review-kgdqQh` and `/tmp/shuf-676-review-5UBagP` as invalid oracle
  profiles, not candidate failures. The corrected original capture is
  `/tmp/shuf-676-review-obyTS7`; `/tmp/shuf-676-review-XWMo4N` additionally exposed
  the filename `?` quoting regression after the main repairs.
- `/tmp/shuf-676-quoting-red.tap`: 135 tests, two failures for filename `?` quoting
  and raw-byte argv incorrectly charged by replacement-character display bytes.
  `/tmp/shuf-676-quoting-green.tap`: all 135 pass after narrow fixes.
- `/tmp/shuf-676-review-o6CWZW/native.snapshot.json`: final external rerun,
  666 comparisons and zero mismatches. `/tmp/shuf-676-capability-recheck.json`
  passes all ten reassessment controls. `/tmp/shuf-676-lifecycle-recheck.json`
  historically passed 19 checks, including the since-withdrawn input metadata
  wait. It is not current 19-control clearance. Its original output-barrier false
  result and all other raw observations remain unchanged.
- Static suites retain 147 original comparisons, 87 independent rows replayed
  under two producer layouts, 16 independent diagnostics, and 524 C/UTF-8 raw
  quoting cases: 861 overlapping snapshot comparisons, not 861 distinct cases.
  Unit tests use memfs and immutable snapshots, without native subprocesses or
  filesystem fixture creation. Default-seed permutation checks and exhaustive
  four-choice byte balance supplement, rather than replace, exact random-source
  comparisons.
- Independent general stdin-consumption equality requires a matching read-ahead
  profile. The static suite asserts all stdout/stderr/status/file effects and
  zero-count consumption; it does not relabel the mismatched prefilled native
  pipe versus one-byte virtual producer as identical. The independently paced
  native control remains in `paced-oracle-v1.json`.

## Final independent repairs

The second independent review retained 976 fresh native cases and 87 recaptures.
Its 24 quoting mismatch comparisons and four public opaque-metadata failures
were validated before repair; the four real/reentrant resource controls prohibit
abandoning owned readers. Earlier claims were limited to the earlier cohort, not
all-input equivalence.

- `/tmp/shuf-676-metadata-quote-red.tap`: 155 tests, 143 pass, 12 fail. The new
  tests reproduce paired quoting failures, opaque capabilities/pathname-stat
  cancellation for ordinary/random input, and reentrant metadata cleanup allowing
  late reader admission. The eight owned open/reentrant-open/handle-stat/read
  controls pass even before the repair. `/tmp/shuf-676-metadata-quote-green.tap`
  records all 155 passing after splitting metadata from acquisitions and sharing
  source-derived character classes.
- Root then identified the positional `#`/`~` fallthrough omitted from that
  classifier. A fresh GNU 8.30 capture spans every printable ASCII byte paired
  with an apostrophe before/after it and after a leading `a`, across both locales
  and ordinary/random/output filenames: 1,710 native rows. Preserve the capture
  and script at `/tmp/shuf-676-ascii-quoting-uo5mpe54/native.snapshot.json` and
  `/tmp/shuf-676-ascii-quoting-capture.py`. The isolated native fixture remained
  empty; stdout/status/diagnostic bytes and executable/source hashes are recorded.
- `/tmp/shuf-676-ascii-quoting-red.tap`: 157 tests, two locale tests fail on the
  positional rule. `/tmp/shuf-676-ascii-quoting-green.tap`: all 157 pass after
  implementing the actual `quotearg.c:524` fallthrough, including noninitial and
  brace controls, rather than substituting another utility's exclusion string.
- New separate immutable evidence is
  `packages/safe-bash/tests/commands/shuf-quote-pairs.snapshot.json` (584 rows from
  the independent pair/followup captures) and
  `packages/safe-bash/tests/commands/shuf-ascii-quoting.snapshot.json` (1,710 fresh
  rows). Both replay under 1-byte and 65,536-byte producer layouts. Together with
  earlier snapshots this is 5,449 overlapping static comparisons; no older
  snapshots or failed evidence were overwritten. Maintained tests remain memfs
  only, with no native subprocesses or disk fixture creation.
- `/tmp/shuf-676-metadata-replay.json` and
  `/tmp/shuf-676-metadata-followup.json` replay all 2,126 independent comparisons:
  historically 2,122 matched, with four failures for
  `-i1-18446744073709551615 -n0`. All 24 reported quoting comparisons matched.
  The description of these four failures as intentional limits is withdrawn:
  they were fixable zero-work admission/allocation defects, repaired next.
- `/tmp/shuf-676-metadata-public-recheck.json` confirms all four public metadata
  cancellations settle exec/dispose/cleanup before release, without opens/reads,
  and preserve false; all four retained/reentrant controls wait and close once.
  Maintained tests additionally cover pathname stat, handle stat/read, metadata
  rejection, reentrant direct cleanup, and idempotency for both input roles.
- `/tmp/shuf-676-metadata-final-summary.json`, asserted by
  `/tmp/shuf-676-metadata-final-validate.mjs`, confirms 18 valid legacy lifecycle
  controls, 18 falsey primary/sole-cleanup/escaping-diagnostic controls, 16 native
  diagnostics, ten output-admission controls, and eight public input controls.
  New lifecycle captures preserve both withdrawn expectations as false results,
  not current defects. Sparse mapped-self-swap and zero-entropy controls remain
  passing; no unconditional permutation claim was added.

## Zero-selection range repair

Root's original-source review correctly rejected the four remaining differences
as unnecessary resource restrictions. Re-read `randperm.c:155` through the `h == 0`
branch, `randperm_bound`, `randread_new`'s zero-byte bound bypass, and
`shuf.c:442` through count minimum, input/random preparation, permutation and
output sequencing. GNU returns no permutation storage for zero selections, but
does not skip the command's later output effects. Repeat always requests a
random source even at count zero; nonrepeat range count zero requests zero bytes.

- Added `packages/safe-bash/tests/commands/shuf-zero-range.snapshot.json`, a new
  immutable GNU 8.30 capture with 112 rows and exact argv, stdout, stderr, status,
  input consumption, and complete fixture file inventories. Original capture:
  `/tmp/shuf-676-zero-range-o2e6jn02/native.snapshot.json`; capture source:
  `/tmp/shuf-676-zero-range-capture.py`. Sources and executable hashes are recorded.
- Covers two near-64-bit-cardinality ranges and the first over-cap cardinality;
  repeated-count minimum in both orders, ignored count overflow, repeat/default
  and explicit/missing random sources, output creation/truncation, random/output
  aliasing, missing-parent/not-directory failures, zero-terminated output, and
  validation errors that must survive zero count. All native stdin stays unread.
- Maintained tests replay each row under both producer layouts, assert complete
  memfs file inventories, prohibit positive-length permutation allocations for
  zero-count range/echo operations, and assert five entropy/reader-admission
  profiles. Positive-count large-range rejection controls remain in place.
- `/tmp/shuf-676-zero-range-red.tap` initially recorded 104 failures: 102 product
  regressions and two overly broad new inventory assertions matching historical
  partial-file snapshots. Restricting inventory assertions to the new complete
  capture yields `/tmp/shuf-676-zero-range-red-validated.tap`: 275 tests, 173 pass,
  102 fail. Both red captures remain preserved.
- The source repair is two lines: skip cardinality admission when the final
  parsed count is zero, and return an empty typed array before permutation
  allocation. No whole-command early return, output/random sequencing changes,
  parser relaxation, positive-selection cap changes, or public configuration.
- `/tmp/shuf-676-zero-range-green.tap`: all 275 tests pass.
  `/tmp/shuf-676-zero-range-types.log`: strict TypeScript exits 0 without diagnostics.
  Static snapshot comparisons now total 5,673, with overlapping cohorts explicitly
  retained rather than counted as distinct cases.
- `/tmp/shuf-676-zero-range-replay.json` and
  `/tmp/shuf-676-zero-range-followup.json`: all 2,126 original independent
  comparisons match, including all four formerly misclassified failures.
  `/tmp/shuf-676-zero-range-native-replay.json`: all 224 comparisons of the 112
  fresh native rows match, including output effects and zero-count consumption.
  `/tmp/shuf-676-zero-range-final-summary.json` records assertion-based validation
  against the unchanged current source hash. Earlier raw snapshots, summaries,
  and failed observations remain untouched; this section corrects their
  zero-count limit classification, not their measured results.

## Check commands and integration limits

Run from the repository root:

```sh
node --import tsx --test packages/safe-bash/tests/commands/shuf*.test.ts
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target es2023 --module nodenext --moduleResolution nodenext --esModuleInterop packages/safe-bash/src/commands/shuf.ts packages/safe-bash/tests/commands/shuf*.test.ts
```

Historical checkpoint before the second independent repair: all 135 tests pass,
scoped strict TypeScript produces no
diagnostics, and the guarded ESLint route exits 0, including zero messages for
the owned source/test files. Logs are `/tmp/shuf-676-final-tests.tap`,
`/tmp/shuf-676-final-types.log`, and `/tmp/shuf-676-final-eslint.log`;
`/tmp/shuf-676-final-checks.exit` records combined exit 0. The duplicate final
lint finished successfully before cancellation was necessary; no process was
killed. Root also independently reported a current 10,435-subject lint pass.

Historical metadata/quoting repair checkpoint: all 157 shuf command tests pass and scoped strict
TypeScript exits 0 with no diagnostics. Logs are
`/tmp/shuf-676-final-repair-tests.tap` and
`/tmp/shuf-676-final-repair-types.log`. The first expanded test type check exposed
two concrete `MemoryFileSystem.capabilitiesFor` fixture typing errors; these were
corrected with typed `Object.assign` overrides, without suppressions. Preserve
`/tmp/shuf-676-metadata-quote-types.log` as failed evidence. No root lint was
repeated for this repair, and its earlier pass is not a new lint clearance.
Root's intentionally red plugin registration test is outside this command-only
checkpoint and remains untouched.

Current zero-selection checkpoint: the same two commands pass all 275 shuf
command tests and strict types, recorded in `/tmp/shuf-676-zero-range-green.tap`
and `/tmp/shuf-676-zero-range-types.log`. No registration/shared files, root lint,
commits, pushes or closure were performed. All 2,126 independent comparisons and
224 fresh zero-range comparisons pass; no remaining measured mismatch is being
waived as a zero-count resource limit.

Scoped direct TypeScript checking is not the package's complete guarded
build/public-consumer gate. Registration,
inventory admission, package/full-workspace tests, public distribution, visual
CLI validation, commit, remote-main verification, and release remain root-owned
follow-up, not completed by this preparation.

Compatibility is pinned to the tested GNU 8.30 Linux/glibc profiles, not all GNU
versions, translated locales, all provider implementations, arbitrary host
JavaScript, or unbounded native resource behavior. String-only VFS paths cannot
represent arbitrary invalid UTF-8 native filenames. The default PRNG, limits,
help/version identity, and pinned sparse quirk must remain explicit in claims.
