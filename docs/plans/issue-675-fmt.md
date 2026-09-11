# Issue 675: GNU-compatible paragraph formatting

## Order and source review

- Process kamilio's issues oldest first; deliver issue 674 before this issue.
- User requires reading each original utility's implementation and a 1:1
  comparison, not a superficially similar or easier-to-test alternative.
- On September 9, read GNU coreutils v8.30 `src/fmt.c` in full, matching
  the installed `fmt` oracle. Reference source is preserved at
  `/tmp/kamilio-675-gnu-fmt-8.30.c`; do not copy GNU implementation code.
- Validate the missing command against the current public registry and record
  failing tests before implementation.

## Required behavior

- Paragraph reflow with default width 75, explicit width, split-only, and
  uniform spacing; VFS file operands and stdin.
- Preserve the original's optimized line-breaking costs, sentence/punctuation
  handling, indentation, tabs, blank lines, and paragraph boundaries. Greedy
  word wrapping is not an equivalent implementation.
- Include original operational options and their interactions: crown margin,
  tagged paragraphs, prefix, goal width, and the first-argument `-WIDTH` form.
- Read original handling of long paragraphs and words before choosing buffering
  behavior; bounded buffering can change line breaks and must be compared.
- Do not weaken input, output, memory, work, cancellation, or VFS restrictions
  to obtain parity. Do not falsely claim GNU implementation/version identity.

## Verification and delivery

- Keep unit fixtures in memory; use independent native experiments to compare
  exact output bytes, error bytes, and exit status, preserving failures.
- Exercise original and candidate with identical inputs and locale settings,
  including binary/control input, tabs, punctuation, indentation, long words,
  repeated options, and errors. Record oracle versions and tested boundaries.
- Register the command and synchronize maintained independent exact inventories
  in its own local improvement. Preserve historical evidence and deliver the
  preceding cmp commit before this utility; local preparation can continue
  while external push approval is pending.
- Verify maintained tests, lint, types, build, packed public entries, and visual
  output. Make one atomic issue commit, verify remote main, close the issue,
  and monitor publication without delaying the next issue's work.
- No README additions are authorized.

## Independent review checkpoint

- The implementation and independent reviewer compare 1,148 primary and 56
  adversarial GNU 8.30 snapshots, preserving exact output/error bytes and status.
  Maintained snapshots are `fmt-native.snapshot.json` and
  `fmt-adversarial.snapshot.json` in `packages/safe-bash/tests/commands`.
- Independent review found and corrected raw-argument diagnostic corruption,
  lossy filename aliasing, and pending acquisition cleanup. The string-path VFS
  cannot represent arbitrary invalid UTF-8 filenames; reject those paths without
  reading a different replacement-character filename. This is not a universal
  native-filesystem parity claim.
- Both complete fmt suites pass 122 tests without skips or cancellations.
  Scoped strict TypeScript and maintained root lint also pass at this checkpoint.
  Acquisition controls cover closed admission, pending cleanup, idempotency,
  and falsey cancellation; the structural cleanup refactor preserves primary
  error precedence without a lint suppression.
- Registration, final public-consumer/visual validation, commit, remote delivery,
  and release verification remain pending. Do not treat this review checkpoint
  as delivery or final integrated acceptance.

## Local integration validation, September 9, 2026

- Registered `fmt` after `cmp` and synchronized the independently maintained
  exact 84-command inventories, replacement counts and family offsets. Original
  sealed historical fixtures remain unchanged. Literal discovery assertions
  cover both fmt suites and the new public registration test.
- Initial public execution returned command-not-found, confirming the missing
  registration. The first plugin-count assertion ran before asynchronous setup;
  corrected the test to inspect the registry after actual execution rather than
  treating that test-order mistake as a product defect. Preserved the failing
  logs at `/tmp/kamilio-675-registration-red-v2.log` and
  `/tmp/kamilio-675-focused-v1.log`.
- Normal workspace build passes. After it completed, all 856 focused Node tests
  pass with no skips, including both complete fmt suites and all modified Bash
  inventories. The four affected playground/bundle/package Vitest files pass
  all 75 tests. Receipts are `/tmp/kamilio-675-build-v1.log`,
  `/tmp/kamilio-675-postbuild-focused.log` and
  `/tmp/kamilio-675-consumer-tests.log`.
- An independent integration reviewer found no blocking discrepancy: all 18
  public-fixture comparisons exactly match native GNU 8.30 stdout/error bytes
  and exit status with `LC_ALL=C`, across default and Node source entries.
  The reviewer also passed 3 registration and 9 inventory/mutation tests and
  scoped strict types. `/tmp/fmt-integration-review-20260909.json` records the
  fixture/source hashes and the complete raw comparisons.
- Inspected the actual playground screenshot at
  `/tmp/kamilio-675-playground-fmt.png`: VFS paragraph wrapping, prefixed piped
  input and the invalid-width diagnostic agree with native expectations and
  render legibly. The task-only browser session was closed and confirmed absent;
  the task-only Vite server was stopped.
- The maintained full lint chain passes: 10,435 configured subjects, zero errors
  or warnings, plus root types and workflow lint. Receipt:
  `/tmp/kamilio-675-lint-v1.log`. This working-tree run includes unregistered
  shuf work; an isolated fmt candidate must exclude that unrelated utility.
- Installed artifact checks remain a separate pending gate at this checkpoint.
  External push/issue-closure approval is pending; no fmt
  delivery or release is claimed. Existing release runs 34307697237 and
  34307696996 both succeeded for the unrelated preceding remote-main commit
  `cc49d6f0f`; these are not cmp or fmt release receipts.

## Cleanup reassessment, September 9, 2026

- The earlier pending-capabilities drain claim was incorrect. Contract
  `src/contracts/command.md` excludes opaque FS promises from the cooperative
  resource barrier. A capabilities query alone acquires no fmt-owned reader.
  The prior checkpoint, integration logs and local commit `a216562cf` remain
  prior-candidate evidence, not validation of this corrected cleanup policy.
- Read-only reproduction is preserved in
  `/tmp/fmt-capability-reassessment-20260909.mjs` and its `.json`/`.log` receipts:
  12 metadata profiles blocked cleanup; actual Shell cancellation and disposal
  waited despite zero reader acquisitions. Three resource controls correctly
  drained owned retirement, including reentrant iterator-factory acquisition.
- Move opaque capability waiting outside `InputScope.acquisition`, retaining
  the post-metadata abort check. Track the actual source/iterator acquisition
  before entering its callbacks, and keep the shared retirement/close promises.
  A direct opaque handler may remain pending, but registered cleanup and public
  Shell cancellation/disposal must settle without waiting for metadata.
- Correct both overstrong tests rather than weakening resource protection.
  Public controls cover six cancellation reasons across streaming/fallback and
  resolving/rejecting metadata, checking exact reason identity, runtime cleanup,
  idempotency and no late acquisition/output. Reentrant iterator acquisition and
  actual Shell reader retirement retain their real-resource barriers. The
  existing falsey primary-versus-cleanup failure controls remain intact.
- TDD red is preserved at `/tmp/fmt-cleanup-correction-red-20260909.tap`:
  seven metadata assertions fail while seven resource controls pass. The narrow
  correction passes all 14 targeted tests in
  `/tmp/fmt-cleanup-correction-focused-green-20260909.tap`. Final full suites
  pass 137/137 (38 primary, 96 adversarial, three registration), without skips or
  cancellations: `/tmp/fmt-cleanup-correction-full-green-v2-20260909.tap`.
  Scoped strict TypeScript over fmt source, both suites and registration passes:
  `/tmp/fmt-cleanup-correction-types-v3-20260909.log` (exit 0). Earlier correction
  receipts, including the initial definite-assignment type error, are preserved.
- No static native snapshots, original red/green logs, sealed historical files,
  registration, public fixtures or maintained inventories are rewritten. This
  correction does not establish a full candidate gate, remote delivery or release.

## Quoting correction and candidate receipts

- The initial local `a216562cf` candidate passed its isolated normal build, full
  lint and installed Node/Bun/browser/types/legacy/FS-only tarball checks.
  Receipts are `/tmp/kamilio-675-candidate-build.log`,
  `/tmp/kamilio-675-candidate-lint.log` and `/tmp/kamilio-675-public*.log`.
  These prior-candidate passes do not override the subsequently reproduced
  cleanup defect or qualify the corrected candidate.
- Root cross-checked apostrophe-plus-question-mark filenames after an
  independent shuf finding. `/tmp/fmt-675-cross-quoting-recheck.json` preserves
  12 GNU 8.30 comparisons in C/C.UTF-8, with ten stderr mismatches. The same
  cmp control passes all 12 comparisons; its source remains unchanged.
- Read the original gnulib shell-quoting branch and restore its question-mark
  exclusion from the apostrophe double-quote shortcut. New immutable evidence
  is `fmt-quoting.snapshot.json`, with native bytes and provenance; both direct
  raw-argument and public Shell tests assert the captured triples. Existing
  snapshots remain unchanged. Root's registration/installed-consumer fixture
  also verifies the exact missing-filename diagnostic.
- Preserved reds: `/tmp/fmt-quoting-correction-red-20260909.tap` and
  `/tmp/fmt-675-public-quoting-red.log`. At the question-mark checkpoint, complete
  fmt and registration suites pass 149/149 without skips or cancellations, and scoped strict types
  pass: `/tmp/fmt-quoting-correction-full-green-20260909.tap` and
  `/tmp/fmt-quoting-correction-types-20260909.log`.
- Root then swept printable ASCII around apostrophes in C/C.UTF-8:
  `/tmp/fmt-675-ascii-quoting-recheck.json` preserves 570 comparisons, 566 exact
  matches and four mismatches for leading `#`/`~` followed by an apostrophe.
  Original gnulib `quotearg.c:527` falls through to compatible quoting for these
  characters only at byte index zero; later positions retain incompatibility.
  Replace the blanket exclusion with that positional rule without changing raw
  decoding, Unicode/glibc printability, or the question-mark correction.
- New `fmt-ascii-quoting.snapshot.json` preserves all 570 native control triples
  and oracle/source/locale/cwd provenance separately from the unchanged original
  12-case quoting fixture. Both direct raw arguments and public Shell dispatch
  compare exact stdout/error bytes and status for every captured case. An explicit
  option terminator keeps leading-hyphen filenames as file operands.
- Positional-rule TDD red is `/tmp/fmt-ascii-quoting-correction-red-20260909.tap`:
  566 pass and four fail. The complete quoting cohort passes 582/582 after the
  fix (1,164 direct/public comparisons), recorded at
  `/tmp/fmt-ascii-quoting-correction-focused-green-20260909.tap`. Complete fmt and
  registration suites pass 719/719 (38 primary, 678 adversarial, three
  registration), zero skips/cancellations:
  `/tmp/fmt-ascii-quoting-correction-full-green-20260909.tap`. Scoped strict types
  pass with exit 0: `/tmp/fmt-ascii-quoting-correction-types-20260909.log`.
  Prior-candidate logs, root evidence and all existing snapshots remain unchanged.
- Final corrected-candidate build, lint, packed-consumer and broad unit gates
  remain pending. No external delivery, issue closure or release is claimed.
