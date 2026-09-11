# Issue 677: GNU-compatible number formatting

## Reopened initialized-buffer parity defect, September 9, 2026

- An independent original-source review finds a new mismatch in the current
  command (`numfmt.ts` SHA-256
  `6f157ba94ace71d9dc41e43a35a1ed171a10b403b2447a2907545c0356f9d40b`).
  Twelve fresh native/public-built-entry comparisons complete: ten mismatches,
  two exact negative controls, no skipped or normalized comparisons. This is
  additional evidence against full parity, not a new command or provider scope.
- Minimal measured case: `numfmt --from=auto -d,`, stdin exactly `1 ,x` without
  a newline. GNU 8.30 exits 2 with empty stdout and stderr exactly
  `numfmt: invalid suffix in input '1 ': 'x'\n`; the current product exits 0,
  emits `1,x`, and has empty stderr. Variants cover embedded NUL, suffix trimming,
  headers and invalid-input diagnostic/output sequencing.
- The reviewed GNU field parser replaces a separator with NUL but retains
  initialized bytes after it. After trailing blanks, its suffix membership test
  accepts NUL, advances past it and observes the retained tail. Standalone field
  slicing loses that context. The repair must preserve only established,
  initialized-buffer behavior, not invent unknown heap contents or emulate
  out-of-allocation reads. Keep existing numeric arithmetic, admission limits,
  cancellation and raw-byte ownership contracts.
- Evidence and actual source/helper read ranges are in
  `out/issue-677-source-audit-v2/report.md`; exact argv/stdin/stdout/stderr/status
  pairs are in `results.jsonl` there. The initial sandbox EPERM capture remains
  separate. All twelve native processes finish and all twelve public shells
  dispose; no production files change during the audit.
- The full maintained `npm test` route subsequently passes on the unchanged
  pre-repair worktree at local HEAD `541042a1a5171418c3f8c71ba8fb10563293fbc4`,
  including native npm pre/post stages. Its green result does not cover these
  newly discovered failures. After that run terminates, start TDD in a separate
  `numfmt-field-buffer.test.ts`, reproduce the measured failures before changing
  `numfmt.ts`, and retain all existing snapshots unchanged. Root owns discovery,
  public/built replay, screenshots, focused integration and atomic delivery.

### Focused repair and qualification

- Four additional pre-repair oracle probes validate prior-record lookahead:
  three new mismatches and one newline-terminated control. The audit therefore
  totals 16 measured profiles, with 13 original mismatches and three matches.
  Prior header bytes, ordinary newline removal and earlier inserted field NULs
  have distinct effects; these are captured rather than guessed.
- The command now retains a bounded byte backing independently of field text.
  It preserves initialized prior-record bytes and actual field/suffix NUL
  mutations, while keeping fresh operands and invocations separate. Backing is
  bounded by the existing 1 MiB record limit plus two terminators. Diagnostic-tail
  scans charge the existing work budget and yield; ignore mode avoids producing
  an unused diagnostic tail. No allocator padding, unknown heap bytes, native
  fallback, new public option or shared-parser change is introduced.
- TDD first reproduces ten failures and two passing controls. Expanded coverage
  reproduces 40 failures and seven passes before the fix. The final direct run
  passes all 871 cases: 824 unchanged original tests and 47 new controls, with
  no failures or skips. New coverage includes both producer layouts, falsey
  stderr/retirement errors, cooperative cancellation, work exhaustion and
  invocation isolation. Original snapshots and raw captures remain unchanged.
- Scoped strict types pass. An additional non-maintained `--noUnusedParameters`
  experiment reports one untouched transitive diagnostic at
  `src/shell/runtime.ts:1271`; it remains in `repair-types-v1.log`, not relabeled
  a passing check. The maintained selected workspace build and root type check
  both pass. Root guarded ESLint completes all 10,475 configured inputs with
  zero errors or warnings, and both selected literal discovery controls pass.
- Fresh built public-entry comparisons pass all 16 profiles independently on
  Node 22.23.2 and Bun 1.3.8. Each run captures fresh GNU output, verifies it
  against the unchanged original capture, compares stdout/stderr/status without
  normalization and disposes all 16 shells. These are 32 fresh comparisons of
  the same 16 profiles, not 32 unique cases or packed-consumer qualification.
- Four actual public-shell `printf %b ... | numfmt ...` workflows pass exact
  output/status assertions. Root visually inspects `terminal-v2.png`. The first
  image retains its incorrect `printf %s` display label despite direct-injected
  input; only the ad-hoc fixture is corrected, and v2 executes the displayed
  pipeline. This was a presentation defect, not another product regression.
- Receipts live under `out/issue-677-source-audit-v2`: `repair-report.md`,
  `root-{build,eslint,types,discovery}-v1`, `public-{node,bun}-v1`, and the two
  screenshot attempts. Frozen command SHA-256 is
  `2f4b00b6f5db20ffcd8e8d6cfaa9c205a6226e7e4cfcea23444826f536b09121`;
  new test SHA-256 is
  `a9aa2760a4be3deafaa70fb28c870329870a5c9174c854cac7628004423c85a9`.
  The earlier full-unit pass predates this focused repair. No fresh full-root
  pass, universal GNU parity, remote delivery, issue closure or release is
  claimed by these focused results.

## Source and confirmed gap

- Resolve kamilio's issues in order; deliver cmp, fmt and shuf before numfmt.
  Local preparation may proceed while external push/closure approval is pending.
- On September 9, 2026, root read all 1,651 lines of GNU coreutils 8.30
  `src/numfmt.c`, matching the installed `numfmt` executable. Reference:
  `/tmp/kamilio-677-gnu-numfmt-8.30.c`, SHA-256
  `6bf0063a9f4ba60c276a0d43ae06ff234eb8dd68a80bdccbcc9aabd0acf6c8d9`.
  Source archive SHA-256:
  `e831b3a86091496cdba720411f9748de81507798f6130adeaef872d206e1b057`.
- Current public execution of `numfmt --to=si 1000` returns status 127 and
  command-not-found. Evidence: `/tmp/kamilio-677-registry-red.json`.
  Add failing behavioral tests before implementation; do not copy GNU code.

## Implementation requirements

- Read the original source and needed `set-fields`, quoting, integer-parsing,
  and formatting helpers. The user requires code-level understanding and exact
  stdout/error/status comparisons, not a docs-only or approximate implementation.
- Support source-defined scaling, units, five rounding methods, suffixes,
  padding, field ranges, delimiter/header handling, printf-style format,
  invalid-input modes, argument input and streamed input. No numeric operand
  is a filename; VFS redirection remains the shell's responsibility.
- Native arithmetic uses extended-precision `long double`, not JavaScript's
  binary64. Characterize precision, intermediate rounding, signed zero and
  diagnostic formatting against the native oracle before choosing a bounded
  representation. Exact decimal arithmetic is not automatically native parity.
- Preserve original field whitespace, header/NUL behavior, suffix trimming on
  failures, partial output and diagnostic order. Read original format-buffer
  and width/precision limits; do not substitute more convenient semantics.
- Bound byte/field/work/output admission and keep cancellation cooperative.
  Drain actual owned resource acquisitions and retirement, not opaque metadata
  promises. Preserve falsey errors, backpressure and raw byte identity.
- No host subprocesses, ambient files, network or LLM calls in the product.
  Keep runtime dependencies empty and implementation in the safe-bash package.

## Verification and integration

- Native experiments use isolated temporary fixtures and pinned locale/tool
  profiles. Retain failing captures. Maintained unit tests use memfs and static
  native evidence, without creating filesystem fixtures or spawning native tools.
- Compare exact output/error bytes and status, including source-derived edge
  cases and adversarial independent review. Unsupported cases are not passes.
- Root owns registration, explicit inventory synchronization, public runtime
  fixtures and visual screenshot validation. Preserve historical evidence and
  unrelated changes. Do not add README content without permission.
- Keep the utility in its own atomic local improvement. Verify committed
  artifacts and maintained checks before remote delivery and issue closure;
  successful publication is a separate receipt. No delivery is claimed here.

## Sidecar checkpoint: September 9, 2026

### Ownership and implementation

- The sidecar worker also read all 1,651 lines of the original `numfmt.c`,
  authenticated both supplied SHA-256 values, and read the needed original
  `src/set-fields.c`, `src/set-fields.h`, `lib/xstrtol.c`, `lib/xstrtol.h`,
  `lib/quote.h`, relevant `lib/quotearg.c` paths, and `src/system.h` field/debug
  definitions. Extracted references remain below
  `/tmp/numfmt-677-sidecar-reference/coreutils-8.30`.
- Added only `packages/safe-bash/src/commands/numfmt.ts`,
  `packages/safe-bash/tests/commands/numfmt.test.ts`, and three numfmt-specific
  snapshot JSON files, plus this plan update. No command registration, shared
  inventory, fixture, README, otherutils, or existing command changes. No
  staging, commits, pushes, issue closure, root build/lint/full-test run, or
  delegation. Root retains public integration, screenshots and independent review.
- Product implementation is independently written TypeScript with no host I/O,
  subprocess, network, LLM, or added runtime dependency. Diagnostic Unicode
  printability data comes from the current existing fmt classification table;
  no old shell-quoting helper was copied or changed. Help text is observed native
  output, not copied GNU implementation code. Tests use the package's in-memory
  filesystem and static captures; maintained tests do not spawn native tools or
  create filesystem fixtures.
- Implements input/output scales, integer units, five rounding modes, padding,
  field ranges, suffixes, delimiter/header/NUL processing, format directives,
  invalid modes, GNU option abbreviation/permutation, debug/developer diagnostics,
  literal operands and streamed stdin. Source quirks covered include suffix
  mutation on invalid output, normalized field separators, optional header
  arguments, signed-32-bit field sorting/merge behavior, format prefix handling,
  the 128-byte formatting buffer, and partial-record read-error ordering/status.

### Precision strategy and boundaries

- The compiled isolated ABI probe reports `LDBL_MANT_DIG=64`, `LDBL_DIG=18`,
  exponent bounds -16381/16384, and 16-byte storage. Receipt:
  `/tmp/numfmt-677-sidecar-reference/precision-probe.txt` (probe source and binary
  remain alongside it). This is an x86-64 GNU/glibc profile, not binary64 or a
  claim about every platform's `long double` ABI.
- Arithmetic uses a bounded signed BigInt significand and binary exponent,
  rounding to 64 significant bits after each multiply/add/divide, including
  decimal digit accumulation, powers, scale divisions and unit conversion.
  A carry can occupy a 65th stored coefficient bit while representing an exact
  power of two. Signed zero and the native exponent/subnormal boundary are
  represented. Decimal formatting rounds the final binary value exactly;
  decimal rational arithmetic is not substituted for native intermediate work.
- `9007199254740993` remains exact where JavaScript Number loses one;
  `9999999999999999999` remains distinct from 1e19. The 27-digit all-nines input
  reaches native 1e27 and the corresponding source diagnostic. Leading zeroes,
  fractional digit limits and 4,931–5,000-place fractional inputs are captured.
- Extended red tests found and fixed lost signed zero in developer output,
  `%Lg` diagnostic double-rounding, literal UTF-8 replacement-character quoting,
  and format precision narrowing: scaled `%.2147483648f` uses printf's default
  six places after signed-32-bit conversion, while `%.4294967296f` uses zero.
  Very large precision is therefore not rejected merely as an allocation size.

### Bounded execution and remaining profile limits

- Caps: 4,096 arguments / 65,536 argument bytes, 4,096 parsed field ranges,
  1 MiB records, 32 MiB cumulative input, 32 MiB emitted content per destination,
  16,777,216 work units and 4,096 empty source chunks. Numeric/option diagnostics
  are additionally bounded by admitted argument/record sizes. Padding is admitted
  only when a converted field actually needs it; omitted fields, empty input,
  headers and help do not allocate or reject irrelevant huge padding buffers.
- Registers cleanup before reader/output acquisition, uses owned input copies,
  awaits writes, yields cooperatively and retires the producer once. Actual
  reader retirement is drained. Opaque pending `next`/sink promises do not become
  unconditional cleanup barriers, and VFS metadata is never requested. Falsey
  read/write/retirement failures retain identity.
- Captured locale profiles are C, C.UTF-8, en_US.utf8 and an invalid-locale
  fallback probe. General installed locale catalogs, arbitrary locale category
  combinations and non-x86 long-double ABIs are not qualified by this sidecar.
  `--version` intentionally reports `numfmt (virtual-bash)` rather than claiming
  to be the GNU binary; it is outside the native byte-parity denominator.
  Finite resource-cap failures are not claimed to match GNU's unbounded resource
  behavior. No blanket all-input/native/public/release parity is claimed.

### Verification receipts

- Oracle: `/usr/bin/numfmt`, GNU coreutils 8.30, explicit `argv[0]=numfmt`,
  executable SHA-256
  `5c600ae55b9fb9259aceb6a16792b6a3e9b1c7671d160660063d4c67aa0e3050`.
  Locale, argument arrays, raw stdin/stdout/stderr hex and status are retained
  per case. The first capture used absolute argv[0]; it is preserved as
  `/tmp/numfmt-677-sidecar-reference/native.snapshot.json`, separately from the
  corrected `native-argv0.snapshot.json`, rather than silently normalized.
- Red-first receipts: `behavior-red.tap` (missing implementation),
  `extended-red.tap` (24 failing cases), and `read-partial-red.tap` (13 failures).
  Original mismatch details/source hashes remain in `extended-first.json` and
  `extended-second.json`. All are below `/tmp/numfmt-677-sidecar-reference`.
- Pre-portability own suite: **802 tests passed, zero failed/cancelled/skipped/todo**,
  1,536 ms in `suite-final.tap`. Composition: 681 static native option/arithmetic
  captures, 13 native read-fault cases, 79 chunk-partition/reused-buffer cases,
  and 29 safety/lifecycle checks. The read-fault oracle uses a directory fd and
  a private /tmp-only `fopencookie` preload shim; no fault injection is present
  in maintained tests or product code.
- Exact command: `node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/numfmt.test.ts`.
  Only this test file is selected. The sandboxed isolated runner failed before
  executing tests; the approved scoped runner completed successfully.
- Scoped strict types passed with no output (`types-final.txt`):
  `node node_modules/typescript/bin/tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --skipLibCheck --target ES2023 --module NodeNext --moduleResolution NodeNext --types node --noUnusedLocals --noUnusedParameters packages/safe-bash/src/commands/numfmt.ts packages/safe-bash/tests/commands/numfmt.test.ts`.
- `final-native.json` / `final-native.txt`: **zero mismatches in all 681 ordinary
  native captures**. Read-error snapshots and the 13 read-fault tests also pass.
  Full owned-file hashes and limits are in `receipt.json` in the same directory.
  Pre-portability product SHA-256:
  `3a3af21ad58c92233c1ad2ad434c9c29e50f391d09206907e9f0329b6fbdf502`.
- Ready for root's independent review. Useful disjoint targets: valid scaled
  arithmetic around SI/IEC power boundaries and intmax decomposition; locale
  category combinations; adversarial output-scope/consumer closure and
  acquisition races; resource-cap precedence; raw argv/diagnostic bytes.
  Existing seeded captures are author evidence, not an independent review.

### Portable execution correction: September 9, 2026

- Root validated an execution-time `globalThis.Buffer=undefined` failure in
  argument byte-length admission. Added six failing no-Buffer regression tests
  before fixing it; `no-buffer-red.tap` records 802 passes and six failures.
  Only the owned command and owned test file changed. Shared byte-value and
  generic diagnostic helpers were inspected, not modified.
- Removed every product `Buffer` reference. Uses bounded Uint8Array/raw-byte
  text conversion, portable UTF-8 length admission and TextEncoder/TextDecoder.
  `getCommandArguments` still validates carrier identity; owned byte carriers
  still use their maintained byte APIs. Plain string arguments avoid the shared
  carrier string-byte path's Buffer dependency. Bounded command diagnostics avoid
  the generic Buffer-backed diagnostic writer. Fatal UTF-8 decoding preserves
  raw invalid-byte distinctions, literal replacement characters and BOM bytes.
- Regression coverage includes root's `--to=si 1000` reproduction, plain and raw
  carriers, UTF-8 suffixes and diagnostics, raw stdin bytes, option failures,
  format prefixes and byte/output admission limits. Buffer is absent throughout
  execute and restored in `finally`; collectors use portable byte APIs. This
  does not claim a full browser bundle or all-package portability qualification.
- Superseding final own suite: **808/808 passed**, zero failed/cancelled/skipped/
  todo, 1,365 ms; `suite-portable-final.tap`. Scoped strict types including unused
  checks: status zero, `types-portable-final.txt`. All 681 ordinary native
  captures still match byte-for-byte/status-for-status (`portable-native.json`);
  all 13 native read-fault tests also pass. No new native mismatch is known in
  these cohorts. Previous qualification receipts remain preserved.
- Superseding product SHA-256:
  `008e8894a688f95482a5ceebdcb2c38a619f398f633c2589beee77f58ca7b5c2`.
  Test SHA-256:
  `ec287073dd46cba55236d8a5e1a0794040fddbfc7361807ebaf4c86db064aabd`.
  Updated owned-file receipt: `/tmp/numfmt-677-sidecar-reference/receipt-portable.json`.
- Mendel independently owns fields/default whitespace/NUL/header/suffix-invalid/
  parser diagnostic review; root independently inspects arithmetic and limits.
  Neither review is counted as completed here. The worker did not duplicate
  their review or mutate shared files, Git state, issues or remote services.

## Root integration checkpoint: September 9, 2026

- Registered `numfmt` once in the standard family after `shuf`. Synchronized the
  maintained independent literal inventories to 86 defaults and 87 with one
  unrelated custom command; the inspection-family slice moves to 63..67.
  Historical sealed inventories remain unchanged. Both new test paths are
  explicitly registered in the integration-input checks.
- Added public factory/plugin tests for direct arguments, pipelines, `env`,
  `xargs`, an actual VFS shell script, redirected table input/output, rounding,
  raw unselected field bytes and partial output before conversion failure.
  Native controls were checked with GNU 8.30, argv0 `numfmt`, LC_ALL=C.
  Three concrete missing-command failures are retained in
  `/tmp/kamilio-677-registration-red-v2.log`; the registered candidate passes
  all three in `/tmp/kamilio-677-registration-green.log`.
- The initial sandboxed isolated Node runner failed before executing the tests;
  it is not the behavioral red result. A root inventory migration initially
  missed one duplicate custom-command count. Its 87-versus-86 failure is retained
  in `/tmp/kamilio-677-inventory-followup-red.log`; the corrected suite passes
  21/21 in `/tmp/kamilio-677-inventory-followup-green.log`.
- Source-focused utility and registration coverage passes 1,938/1,938, with no
  skips, in `/tmp/kamilio-677-integration-focused-v1.log` (exit receipt zero).
  Normal `npm run build` passes in
  `/tmp/kamilio-677-integration-build-v1.log`. Full `npm run lint` passes in
  `/tmp/kamilio-677-integration-lint-v1.log`: 10,439 configured ESLint subjects,
  zero errors/warnings, plus root TypeScript and workflow checks. Post-build
  focused and consumer checks are running separately; no result is assumed.
- Shared installed-consumer workflows now check `numfmt` through default/Node
  entries and the browser fixture. These fixture edits alone are not packed-
  artifact acceptance; clean committed tarball verification remains pending.
- Actual playground browser execution matches the native stdout and stderr
  exactly, including trailing newlines, for IEC units, positive/negative nearest
  rounding, header/field conversion and partial failure with status 2.
  Native channel receipts: `/tmp/kamilio-677-visual-native.stdout`, `.stderr`,
  `.exit`; browser transcript: `/tmp/kamilio-677-playground-aria.yml`.
  Root viewed `/tmp/kamilio-677-playground.png`. Task browser session
  `af51e40a-fa33-4919-a9ac-6ecbbcc62e79` was closed and confirmed absent;
  its dedicated port-5191 Vite process was stopped.
- Independent field/parser scrutiny now passes 2,662/2,662 exact native
  stdout/stderr/status comparisons: 1,331 rows, 1,282 unique input profiles,
  two producer layouts, bound to product SHA-256
  `008e8894a688f95482a5ceebdcb2c38a619f398f633c2589beee77f58ca7b5c2`.
  Report/source-reading receipts:
  `/tmp/numfmt-677-independent-epp6yp/review.md` and `source-reading.md`.
  Separate independent arithmetic and lifecycle/limit reviews are still running.
- Full uncached testing for predecessor `shuf` remains active in its immutable
  detached candidate, not this dirty numfmt tree. Remote main independently
  advanced to `d45e9edec6cc45ad3d899b696ba9c353bc5749c6` with the backtick fix;
  preserve it and revalidate the combined delivery candidate. External
  push/closure approval is still pending. No numfmt commit, push, issue closure,
  release, whole-suite pass or all-input/native parity is claimed here.

- Post-build follow-up completes successfully: 2,757/2,757 selected Node tests,
  no skips, in `/tmp/kamilio-677-postbuild-focused-v1.log`; 75/75 consumer tests
  across four Vitest files in `/tmp/kamilio-677-consumer-tests-v1.log`. Both exit
  receipts are zero. These are focused checks, not the full uncached unit gate.

## Bounded output-diagnostic admission repair — September 9, 2026

Disjoint repair ownership is limited to `src/commands/numfmt.ts`,
`tests/commands/numfmt.test.ts` within `packages/safe-bash`, and this appended
section. No registration/shared files, README, Git actions, build, full lint or
full unit gate are part of this repair. Root retains independent verification,
artifact rebuilding, screenshots and packaging.

### Validated defect and source review

- Read the current numfmt implementation and command tests, concentrating on
  `Converter.emit`, padding admission, ordinary warnings, both terminal diagnostic
  catches, cancellation and owned cleanup. Read the GNU 8.30 original's
  `simple_strtod_fatal`, parsing/format diagnostics, `prepare_padded_number`,
  `print_padded_number`, field/line processing, invalid-mode status selection and
  final read/debug diagnostics. GNU writes ordinary diagnostics before preserving
  an invalid field under warn/fail modes; no GNU 32 MiB output cap is implied.
- GNU source: `/tmp/kamilio-677-gnu-numfmt-8.30.c`, SHA-256
  `6bf0063a9f4ba60c276a0d43ae06ff234eb8dd68a80bdccbcc9aabd0acf6c8d9`.
  The independently reviewed product started at
  `008e8894a688f95482a5ceebdcb2c38a619f398f633c2589beee77f58ca7b5c2`.
- `/tmp/numfmt-677-lifecycle-independent-GKaemy/review.md` and its untouched
  `stderr-minimal.mjs` demonstrate ordinary warnings filling stderr exactly,
  followed by an outer PublicDiagnostic write bypassing `Converter`'s counters.
  The repaired accounting also covers the separate NumfmtDiagnostic catch.
- Reproduced before editing source in
  `/tmp/numfmt-677-output-cap-repair-red.json`: both direct and actual default
  registered public Shell routes write 33,554,469 stderr bytes, 37 above the
  fixed 33,554,432-byte cap. Both retain status 1, 8,388,562 stdout bytes,
  nine records read and one producer retirement. Original independent/root
  failures and earlier oracle snapshots remain unchanged.

### Exact accounting and failure behavior

- One invocation-local emission path now owns stdout/stderr counters before
  option parsing and is used by conversion output, warnings, help, header output
  and both terminal diagnostic catches. Padding consults the same stdout budget.
  Limits remain 32 MiB per destination; no hidden diagnostic margin, smaller
  configured budget, test-only production knob or shared-contract edit was added.
- Admission checks the complete byte-string length before any chunk is written.
  Raw diagnostic bytes remain raw; outer PublicDiagnostic text is UTF-8 encoded
  before accounting. Admitted writes retain 65,536-byte chunking/backpressure.
- If an ordinary emission exceeds its destination's remaining space, processing
  stops and attempts the normal complete output-limit diagnostic on stderr.
  If a complete terminal diagnostic cannot fit, none of that diagnostic is
  emitted and the command returns status 1 after cleanup. Previously emitted
  bytes remain unchanged, including a completely full stderr destination.
  This is explicit whole-message admission failure, not partial diagnostic
  truncation or silent continuation. A terminal diagnostic that exactly fits is
  emitted completely. An exact-full successful warning stream still returns 0
  in warn mode when no subsequent emission is attempted.
- Only this invocation's own admission-error identity selects the terminal
  status-1 path. Falsey sink/producer failures, an independently created
  PublicDiagnostic with the identical message, and secondary cleanup precedence
  are not mistaken for owned admission failures. Ordinary native diagnostics and
  statuses remain unchanged when admitted. Cleanup still retires owned work;
  it is not bypassed or weakened to enforce the byte cap.
- Returning status 1 for an unadmitted terminal diagnostic also prevents public
  Shell's ordinary exception mapping from issuing a fresh, unaccounted fallback
  diagnostic. Actual host/cleanup failures retain their existing rejection
  semantics; this does not change the runtime's handling of arbitrary failures.

### TDD and current receipts

- Added nine real-cap counting-sink profiles: direct/public exhaustion, exact-full
  ordinary warnings without a reserved margin, both terminal catch paths at
  exact-fit and one-byte-over boundaries, and UTF-8 byte accounting with global
  Buffer absent. All use the real production cap and bounded generated input,
  with no disk fixtures/native subprocesses in unit tests. Seven additional
  sink/secondary-cleanup profiles preserve falsey or same-message error identity.
- `/tmp/numfmt-677-output-cap-tests-red.tap`: 824 tests, 818 pass, six validated
  admission failures. `/tmp/numfmt-677-output-cap-tests-green-v2.tap`: all 824
  pass, zero failed/cancelled/skipped/todo, approximately 10.7 seconds including
  all real-cap cases. A mechanical patch-loader error temporarily left call sites
  incomplete; its failed intermediate run remains preserved in
  `/tmp/numfmt-677-output-cap-tests-green.tap` despite that premature filename.
  It is not a passing receipt and was corrected before the final checkpoint.
- `/tmp/numfmt-677-output-cap-types.log`: scoped strict TypeScript exits 0 with no
  diagnostics. Exact commands from the repository root:

  ```sh
  node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/numfmt.test.ts
  node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target es2023 --module nodenext --moduleResolution nodenext --esModuleInterop packages/safe-bash/src/commands/numfmt.ts packages/safe-bash/tests/commands/numfmt.test.ts
  ```

- `/tmp/numfmt-677-output-cap-repair-green.json`: rerunning the same unmodified
  independent harness gives exactly 33,554,432 stderr bytes on both direct and
  default-public routes, zero excess bytes, status 1, the same 8,388,562 stdout
  bytes, nine records and one retirement. Public disposal completes. Source hash
  is stable before/after the reproduction:
  `6f157ba94ace71d9dc41e43a35a1ed171a10b403b2447a2907545c0356f9d40b`.
- The previously reported 179 arithmetic, 2,662 field and 99 retained independent
  lifecycle comparisons belong to their original reviewed source. They were not
  rerun or claimed as fresh clearance here. Maintained native snapshots and own
  lifecycle tests pass in the 824-test suite; root's independent re-verification
  and artifact/public gates remain separate.

## Corrected root gate: September 9, 2026

- Final command SHA-256 is
  `6f157ba94ace71d9dc41e43a35a1ed171a10b403b2447a2907545c0356f9d40b`.
  Root's unchanged direct/default-public cap reproduction now emits exactly
  33,554,432 stderr bytes, 8,388,562 stdout bytes, status 1 and one retirement
  per route. Receipt: `/tmp/kamilio-677-stderr-cap-root-green.json`.
- Independent corrected-cap review passes its two original reproduction routes,
  all 99 retained lifecycle controls and 19 additional boundary/failure controls.
  The original 13 withdrawn assumptions remain excluded, not relabeled passes.
  Receipt: `/tmp/numfmt-677-lifecycle-independent-GKaemy/repair-review.md`.
- Author replay of independently designed cohorts passes 179 arithmetic and
  2,662 field/parser comparisons on this hash. The arithmetic calls are fresh;
  field/parser native oracles are unchanged prior captures. No skipped or
  incomplete calls are included. This is regression replay, not a new independent
  author review. Receipt: `/tmp/numfmt-677-cap-regression-m9EFmj/summary.json`.
- Normal `npm run build`, full `npm run lint` and uncached maintained `npm test`
  all exit 0. Lint covers 10,439 configured files with no errors or warnings,
  plus root types/workflows. The full unit route includes 20,343 shared passes
  and one skip, 24,553 Bash passes and 63 skips, 21,653 SafeJS passes and 37
  skips, 288 terminal passes and the two native posttest lint-stress checks.
  Skips and optional unavailable comparator evidence remain separate from passes.
- This gate also includes the separate synchronous-push repair; it is not an
  isolated numfmt-only commit gate. The rejected array-measurement shortcut was
  absent. Candidate file hashes match before/after the entire run. Receipts:
  `/tmp/kamilio-677-corrected-{build,lint,full-unit}.{log,exit}` and
  `/tmp/kamilio-677-corrected-candidate-{before,after}.sha256`.
- Corrected browser validation repeats the original visual script. Its 55-byte
  stdout and 30-byte stderr match native captures including trailing newlines.
  Root viewed `/tmp/kamilio-677-corrected-playground.png`; the associated ARIA
  capture is retained. Task browser and loopback server were closed and verified
  terminal. No truncation or whitespace normalization was applied.
- Clean committed tarball/public-consumer qualification remains required. No
  push, issue closure or successful remote release is established by these local
  results. Remote main still includes the separately authored backtick repair
  and must be preserved when integrating delivery candidates.
