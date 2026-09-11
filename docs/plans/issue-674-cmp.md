# Issue 674: bounded byte comparison

## Requirement and validation

- Author: kamilio. Process this after reviewing older open issue 662; its
  independently reproduced static-Worker lifecycle failure does not justify a
  speculative SafeBash cleanup change.
- Published SafeBash 0.1.502, from the current main product code, returns status
  127 and `cmp: command not found` when comparing equal binary VFS files.
  Evidence: `/tmp/kamilio-674-published-red.json`.
- Add default `cmp` byte comparison: equality status 0, differences status 1,
  first differing byte and line, silent comparison, octal differing-byte lists,
  maximum comparison length, and standard-input operands. Operational/usage
  failures must retain the appropriate trouble status rather than equality.
- Validate GNU behavior with native differential observations. Do not claim
  support for unimplemented GNU options or reinterpret binary data as text.

## Implementation and safety

- Keep implementation in SafeBash and reuse its maintained stream, filesystem,
  budget, cancellation, and command-registration contracts.
- Use VFS paths only. Bound input, temporary memory, output and CPU work;
  preserve producer-owned byte reuse, backpressure, cancellation identity and
  awaited cleanup, including early comparison termination.
- Keep exact current command inventories explicit and synchronized. Do not
  rewrite frozen historical evidence or derive expected names from the product.
- No runtime dependency or README addition is authorized by this plan.
- Reuse the existing 32 MiB byte-input ceiling for aggregate comparison input;
  do not introduce an unrequested public configuration surface solely for tests.

## Verification and delivery

- Read the original utility implementation before accepting compatibility.
  On September 9, read GNU diffutils v3.7 `src/cmp.c` in full, matching
  the installed GNU comparator version. Reference copy:
  `/tmp/kamilio-674-gnu-cmp-3.7.c`. Use its behavior as a reference, not
  copied implementation code.
- The user's strengthened acceptance requirement is a direct 1:1 comparison
  with the original, not approximate diagnostics or a passing option subset.
  Include operational GNU options, repeated-option semantics, unusual names,
  errors, stdin, and exact stdout/stderr bytes and exit status. Preserve
  sandbox limits and do not falsely identify this implementation as GNU.
- Record failing tests before implementation; verify focused semantics and
  independent adversarial streaming/cancellation checks.
- Exercise installed Node, Bun and browser public entries, not just source
  imports. Visually inspect the relevant CLI/playground output.
- Run maintained lint, type, build and test gates appropriate to the final
  changed scope; preserve failures and fix validated causes before delivery.
- Pull/rebase main, commit only owned files, push verified fixes, immediately
  close the issue after verifying remote-main delivery, then monitor both
  GitHub release workflows. Verify npm publication separately.

## Oldest-issue refresh

On September 9, a fresh bounded run of issue 662's immutable no-SafeBash
Control C completes ten cycles each under Bun 1.3.8 and Node 22.23.2, with
zero outbound requests. The prior intermittent failure remains preserved;
this single passing attempt neither establishes Bun health nor attributes the
original macOS failure. No speculative product patch or closure is justified.
Evidence: `/tmp/kamilio-662-refresh.mBtDME/report.json`.

## Independent comparison findings

The September 9 initial 143-case GNU 3.7 differential experiment passed only
71 cases; 72 mismatched. This is a failing baseline, not acceptance. Exact
triples are preserved in `/tmp/kamilio-674-native-differential-v4.json`.
Findings include unterminated EOF wording, raw filename rendering, filesystem
error messages, silent-mode read errors, same-directory comparison, repeated
limits, and missing print-byte/skip options. The native side used file-backed
stdin, which does not establish pipe-stdin behavior. Earlier attempts retain
their harness failures (sandbox subprocess refusal, early-exit pipe EPIPE,
and a temporarily unavailable dependency during a build).

## Maintained-gate environment

- Normal workspace build passed after rerunning outside the sandbox: tsx IPC
  had been refused inside it. Logs: `/tmp/kamilio-674-build.log` and
  `/tmp/kamilio-674-build-v2.log`. This preceded the GNU-parity corrections
  and is not final-candidate build acceptance.
- Initial root test route was refused at its Git subprocess in the sandbox.
  The unrestricted attempt found 11 failures in three shared-test files.
  Removing inherited `NO_COLOR` avoided color-setting warnings contaminating
  subprocess output, and completing the build resolved the unavailable
  toolcraft dependency. Both affected subprocess suites then passed.
- Three filesystem-guard tests correctly refused the overfull global `/tmp`
  ancestor. An owned checkout-local `TMPDIR` passed all 272 tests without
  modifying or weakening their directory-entry bound, but a later full run
  correctly found that nested Vitest fixtures under ignored `out/` were excluded.
  An owned `/var/tmp` directory passes both controls (273 tests). Evidence:
  `/tmp/kamilio-674-environment-recheck.log` and
  `/tmp/kamilio-674-var-tmp-recheck.log`.
- The fourth full attempt passed all 20,317 shared tests but archive consumers
  failed with `tar.Parser is not a constructor`: the local Node 22.22.0/npm
  toolchain resolves a different bundled tar API. The previously verified
  CI-image Node 22.23.2/npm toolchain passes the exact archive dependency
  regression without source changes. Preserve the failed full attempt at
  `/tmp/kamilio-674-test-v4.log`; the focused repair evidence is
  `/tmp/kamilio-674-archive-toolchain-recheck.log`. A fresh full gate is required.
- Initial maintained root lint found exactly two errors in `cmp.ts`; both
  were corrected without suppressions. Root lint v3 subsequently passed all
  10,430 configured subjects with zero errors/warnings, then types/workflows.
  Later raw-argument and fixture changes still require final validation.
- Full attempt v5 reached the SafeBash phase: 22,646 passed, 30 failed and
  63 skipped; this is not a passing gate. One maintained byte-family test
  exposed accidental tightening of iterator-only command limits. The repair
  preserves that unchanged test and activates shared cumulative admission only
  when the new bounded API participates; its expanded cohort passes 374 tests.
- The other v5 failures reflect concurrent work, not native semantic findings:
  a GNU shell batch rejected differing before/after source hashes, and public
  cleanup snapshot builds observed in-progress `shuf` type errors. Preserve
  `/tmp/kamilio-674-test-v5.log`. Isolated stable-source rechecks pass all nine
  shell-batch tests and all 20 public-cleanup tests. Freeze repository source
  during the next complete gate rather than weakening source admission.

## Shell-level parity blockers

The 72 originally failing direct-command triples now match in a scoped recheck
(`/tmp/kamilio-674-native-differential-recheck.json`). This does not establish
overall acceptance: independent real-shell comparisons found additional
observable differences that must be fixed before delivery.

- File-backed stdin loses the metadata used for GNU verbose offset padding;
  the same bytes through a pipe correctly have different padding. Evidence:
  `/tmp/kamilio-674-redirect-differential.json`.
- A shared file-backed stdin with different initial skips follows a different
  native path from a shared pipe, including native descriptor-close behavior.
  Preserve both observed profiles rather than replacing one with the other.
- `{ cmp -n1 - right; cat; } <left` and the equivalent pipe consume all of
  `left` instead of leaving its bytes after the first for `cat`. A zero-byte
  comparison preserves input. Exact native and candidate outputs:
  `/tmp/kamilio-674-stdin-consumption.json`.
- Fix the shared-input/provenance boundary rather than manipulating output
  spacing, changing expected native output, or excluding these shell cases.
- Additional source-guided checks reproduce permission-admission failures:
  an unreadable file incorrectly compares equal to itself (including `-n0`),
  and `-s` incorrectly emits the deferred permission error. GNU refuses during
  open before either shortcut and suppresses that open error under `-s`.
- GNU stdout-null detection also affects stderr: `cmp -l` on `a` versus `bb`
  emits no EOF diagnostic when stdout targets `/dev/null`, but `a` versus
  `ab` still emits EOF. Preserve actual destination identity, including aliases,
  rather than interpreting every character device or discarded sink as null.
- Native experiments may create isolated temporary fixtures. Maintained unit
  tests must not create files; use memory filesystems and versioned raw native
  snapshots, with the comparator version and input profile recorded.

## Additional source-guided controls

- Retained stdin metadata must come from the opened handle, not the earlier
  pathname stat: replacing a path during open otherwise produces incorrect
  verbose offset padding. Retained acquisitions, stat and reads must finish
  before their owned handles close.
- Bounded shared reads must honor CPU and cumulative input admission, including
  repeated one-byte reads and large producer chunks. Charge produced bytes
  before copying, without recharging restored owned chunks after cancellation.
- The playground was exercised and its terminal output visually inspected:
  first difference, verbose and silent comparisons, bounded comparison, and
  subsequent `cat` preserving `bcdef` after `cmp -n1`. Screenshot:
  `/tmp/kamilio-674-playground-comparison-complete.png`. The task-owned browser
  session and development server were closed after inspection. This does not
  substitute for final packed-consumer or maintained-gate acceptance.
- Final cmp owner checkpoint matches 448 native snapshot triples and 27 live
  stdin replays. The cmp and independent adversarial suites pass 218 and 61
  tests respectively. Raw-argument review first reproduced 17 failures, then
  covered invalid-UTF8 alias rejection plus Unicode/BOM/astral/U+FFFD names,
  diagnostics, first differences, EOF and stdout-null behavior. Evidence:
  `/tmp/kamilio-674-cmp-final-argv-{maintained,snapshots,adversarial,types}.log`.
- Honest virtual-bash help/version and documented sandbox limits intentionally
  differ from GNU. The string-path VFS rejects unrepresentable invalid-UTF8
  filenames without accessing a replacement-character alias. Arbitrary GNU
  localization is not claimed; exact tested triples are not universal parity.

## Pre-integration acceptance

- The complete maintained `npm test` route passes at the stable working-tree
  checkpoint: `/tmp/kamilio-674-test-v6.log`, exit 0. SafeBash reports 22,860
  passing tests, zero failures and 63 skipped cases; unavailable cases are not
  counted as passes. The declared shared, SafeJS, terminal and native posttest
  tasks also complete successfully. This tree includes unregistered future
  utility tests; those utilities are not part of the cmp commit or artifact.
- Normal workspace builds pass for both the working tree and the cmp-only
  source archive of local commit `9484bbce0`. The archive becomes a detached
  verification worktree, with no development branch and no changes to main.
  Its complete maintained lint route passes all 10,427 configured subjects,
  type checks and workflow checks: `/tmp/kamilio-674-candidate-lint-v2.log`.
  The working-tree lint's two remaining errors belong to uncommitted shuf work,
  not this candidate; they remain for that utility's repair.
- Scoped tarballs built from the cmp-only source explicitly contain cmp and
  exclude fmt/shuf. Installed Node 22.23.2, Bun 1.3.8, browser bundle, declarations
  and legacy `poe-code@14.0.4` consumers pass. Logs are
  `/tmp/kamilio-674-committed-{node-v2,bun-v2,browser-v2,types,legacy}.log`.
- The first public fixture incorrectly expected `byte` in the C locale.
  Native GNU controls confirm `char` for C and `byte` for C.UTF-8. Correct the
  fixture to exercise both explicit profiles, not the matching implementation.
  Original failed public logs remain preserved. The corrected fixture in the
  delivery tree is byte-identical to the successful isolated consumer fixture.
- Remote main advances independently to `cc49d6f0f` during these checks.
  Preserve that concurrent mv fix when integrating cmp; the prior full gate
  is not represented as a test of the yet-to-be-rebased combined tree.

## September 9, 2026: zero-limit pipe-skip regression

- Renewed source-first scrutiny finds a concrete missed workflow, not a version
  identity difference. GNU diffutils 3.7 `cmp.c` discards a nonseekable initial
  prefix before entering its comparison loop, including when `-n0` requests no
  compared bytes. The existing virtual cursor only discards that prefix while
  filling comparison buffers, which the zero-limit loop never requests.
- With input bytes `01 02 80 ff`,
  `cat left | { cmp -n0 -i2:0 - right; cat; }` must leave `80 ff` for the final
  `cat`. The current implementation instead leaves all four bytes. Reversing
  stdin's operand position reproduces the same bug. Both implementations return
  status 0; checking only status or cmp's own empty output would miss it.
- Four bounded original controls and their exact stdout/stderr/status are in
  `out/issue-674-cmp-audit-v1/native-v2.json`. The in-memory reproduction records
  two failing pipe-skip cases and two passing no-skip/seekable controls in
  `unit-red-v1.log`; no product change precedes that reproduction. Original
  source and executable hashes are retained; executable bytes are not decoded.
- Root assigns the cmp owner a focused cursor/test repair. Preserve early-open
  failures, same-input shortcuts, bounded reads, cancellation and cleanup.
  Consume the skipped bytes, not any downstream byte, and retain native results
  unchanged. Existing version/localization limitations are not user waivers of
  the renewed one-to-one comparison requirement.
- After the maintained focused regression and neighboring tests pass, inspect
  an actual source-shell terminal capture using the maintained screenshot tool:
  pipe an ASCII input through both operand orientations, a zero-skip control and
  a seekable-input control, then inspect what the following `cat` receives.
  This ad hoc visual check supplements the binary-byte regressions; it is not a
  screenshot test, packaged-consumer qualification, push or release.

### Focused repair and verification

- The cursor now consumes pending nonseekable prefixes before comparison while
  retaining existing admission and early-return ordering. A zero-limit named
  nonregular stream receives a positive, bounded chunk hint; positive-limit
  hints are unchanged. No new API, backend policy, shared-input protocol or
  native fallback is introduced.
- The owner reads all 695 lines of the original utility and, after bounded
  retrieval of the official 3.7 source archive, all 109 lines of `lib/cmpbuf.c`
  and 19 lines of its header. The archive's utility bytes match the previously
  authenticated original before its helpers are used. Source hashes, admission
  limits and relevant helper sections are recorded in
  `out/issue-674-cmp-skip-repair-v1/handoff.md`.
- Maintained TDD preserves the initial 23-failure/7-pass reproduction and the
  later independently reproduced zero-chunk stream defect. The final focused
  results pass 34 new regressions, 218 existing cmp tests and 61 adversarial
  tests: 313 individual cases, no failures or skips. The selected three-file
  runner and scoped strict types also pass. The original four unchanged native
  controls replay successfully; that is not a fresh native execution.
- Terminal inspection passes all four ASCII workflows with the expected
  downstream output `CD`, `CD`, `ABCD`, `CD`, each exit 0 and empty stderr.
  The maintained screenshot tool renders
  `out/issue-674-cmp-skip-repair-v1/terminal-v2.png`, which root visually inspects.
  The first image remains: its fixture incorrectly supplied strings to the
  Uint8Array-only filesystem API and failed before cmp ran. Only the fixture is
  corrected; that failed capture is not a product regression or passing test.
- These checks concern the current source fix, not the older packed artifacts.
  Full-repository unit completion and the separate truncate native metadata/lock
  prerequisite remain unproven. No remote delivery or issue closure is implied.
- The maintained discovery route includes `tests/commands/cmp-skip.test.ts`
  exactly once. Root `npm run lint:eslint` completes successfully for all 10,473
  configured inputs, with zero errors and warnings; receipt:
  `out/issue-674-cmp-skip-repair-v1/root-eslint-v1.log` and `.exit`.
  This is the ESLint gate, not a claim that the full root lint/types/workflow or
  full unit route was rerun after this focused fix.

## Explicit discovery guard and later verification

- September 9, 2026: the cmp skip regression already executes through automatic
  discovery, but its explicit membership assertion is missing from the maintained
  discovery test. A failing literal-admission check confirms that omission before
  adding the single assertion. This is a missing future-discovery guard, not a
  newly discovered failure of cmp or an assertion that the test previously never ran.
- The literal check then passes, as do both selected maintained controls for
  default runner membership and current integration type accounting. Root guarded
  ESLint completes all 10,475 configured inputs with zero errors or warnings.
  Receipts: `discovery-literal-{red,green}-v1`, `discovery-maintained-v1`, and
  `discovery-eslint-v1` under `out/issue-674-cmp-skip-repair-v1`.
- Later broader evidence now exists: full maintained `npm test`, including
  post-test stages, passes at local `541042a1a` before the subsequent numfmt fix.
  After that fix, the maintained Bash workspace route passes at `d1989dff6`:
  302 runner checks and 26,596 Bash tests, with 63 skips reported separately.
  This last result is a Bash workspace pass, not a second whole-root pass.
- The cmp implementation, existing regression bytes and native captures remain
  unchanged. This checkpoint adds no new native comparisons and makes no claim
  of packed-root qualification, remote-main delivery, issue closure or publication.
