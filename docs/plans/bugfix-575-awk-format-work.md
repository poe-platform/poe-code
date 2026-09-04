# Bugfix 575: AWK formatting work admission

## Scope

- September 4, 2026; starting HEAD `070c762bd` after root's batch-six delivery.
- Own only narrowly necessary AWK formatter/runtime budget threading, the existing
  unsealed text-program `allocation-admission.test.ts`, and this plan. No new test
  registration, README, seals, boundaries, sed production, or shared budget edits.
- Original sed transliteration and AWK rebuild joins already admit proportional
  work. Retain their small existing regressions; numeric field conversion still
  reaches the uncharged formatter and belongs to this residual correction.
- Fix runtime printf/sprintf and implicit CONVFMT/OFMT formatting admission, not
  parser admission, filesystem output quotas (#576), or aggregate memory (#597).

## TDD and compatibility

- First add tiny failing scan/output/padding controls (at most 128-byte output),
  with spies proving rejected padding never runs. Cover literal/escaped percent,
  dynamic width/precision, configured buffer limits, numeric conversion and exact
  byte-oriented Unicode behavior. Preserve evaluation/error order and printf ORS.
- Thread the existing invocation budget through formatting and numeric coercions.
  Admit format scan work before runtime scanning and output growth before slicing,
  precision/width padding or concatenating it. Keep finite numeric conversion
  bounded; preserve existing precision, flags and hard limits without cap raises.
- Run only named tiny tests and focused no-emit type evidence with Node 22 from
  `/tmp/kamilio-toolchain.path`, private TMPDIR from
  `/tmp/kamilio-561-562-tmp.path`, TSX_DISABLE_CACHE=1, unset NO_COLOR and cleared
  child Git-local variables. All exec calls require escalation.
- No heavy allocation, stress, CPU/RSS measurements, builds, broad gates, Git
  mutations, commits or pushes. Root owns integration, full gates and release.

## Initial evidence (superseded by coercion follow-up)

- RED against unchanged production: 20 selected tests, 19 expected failures and
  one existing-semantics preservation pass. Failures proved missing scan/output
  charges and observed padding before rejection, including implicit conversions.
- First GREEN: the same 20 tests passed. Added two small observer/boundary tests
  for string slicing, floating precision, exact step admission and falsey abort.
- Final frozen-code selection: 55/55 passed, zero failures/skips/cancellations/TODOs.
  This is 22 formatter tests plus 33 existing small admission, AWK composition,
  syntax/effect ordering and mocked-clock cancellation tests. Existing sed byte
  translation and AWK component/separator join admission passed unchanged.
- A separate in-memory comparison against `070c762bd` matched output/error for
  31 ordinary numeric/format controls: signed/unsigned integers, radix prefixes,
  zero precision, scientific/fixed/general notation, precision 100, dynamic
  width/precision, Unicode, percent literals and invalid non-finite controls.
  This comparison preceded only style and legacy-cap diagnostic-order cleanup;
  the final complete tiny selection ran after those edits.
- Focused no-emit TypeScript checking passed after final source/test edits, using
  the package's strict compiler options and three explicit owned file roots plus
  their imported closure. This is not the maintained whole-package type gate.
- Node v22.22.0, prescribed private TMPDIR, disabled TSX cache, unset NO_COLOR,
  cleared child Git-local variables and escalated exec were used throughout.

### Exact selected commands

After the environment setup above, initial RED and first GREEN used:

```sh
node --import tsx --test --test-concurrency=1 --test-reporter=spec --test-name-pattern='awk format work' packages/safe-bash/tests/commands/text-programs/allocation-admission.test.ts
```

The final selected tests and focused type check used:

```sh
node --import tsx --test --test-concurrency=1 --test-reporter=spec --test-name-pattern='awk format work|sed transliteration|awk bounded joins|awk formatted print|awk no-argument print|awk joins |awk print evaluates|awk SUBSEP|awk split resolves|text-program checkpoint|awk rejects unsupported syntax|awk streams one-byte records' packages/safe-bash/tests/commands/text-programs/allocation-admission.test.ts packages/safe-bash/tests/commands/text-programs/awk.cases.ts packages/safe-bash/tests/commands/text-programs/cancellation.cases.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node packages/safe-bash/src/commands/text-programs/awk-values.ts packages/safe-bash/src/commands/text-programs/awk-runtime.ts packages/safe-bash/tests/commands/text-programs/allocation-admission.test.ts
```

Evidence logs are below the directory named by
`/tmp/kamilio-561-562-tmp.path`: `575-format-red.txt`,
`575-format-green-1.txt`, `575-numeric-compatibility.txt`,
`575-freeze-tests.txt`, and `575-freeze-types.txt`.

### Initial frozen owned SHA-256 (historical)

- `packages/safe-bash/src/commands/text-programs/awk-values.ts`:
  `f72a185ec2a5239ce022ec384804372a16665f4a16b8aacb8e3d476e21f6d8cf`
- `packages/safe-bash/src/commands/text-programs/awk-runtime.ts`:
  `efe28b0aecd901eb0d9cfc1300fdb5314de6eab160083174ce7f4aab431e5f0b`
- `packages/safe-bash/tests/commands/text-programs/allocation-admission.test.ts`:
  `fc644b696782c446181ac7c1a180c0cd801cd1148630eaa3bcfd562861cec6b3`

## Correction and handoff limits

- Runtime formatting charges the complete format length before scanning and
  each produced byte before output construction, including literal/percent paths.
  Width and integer precision admission account for sign/radix prefixes before
  padding. Configured output capacity and the existing 32 MiB formatter ceiling
  apply before output growth; the legacy hard-ceiling diagnostic has precedence.
- Numeric conversion has a pre-conversion work charge, proportional to floating
  precision where applicable. Finite-number conversion uses existing bounded
  numeric staging to determine exact output size, rather than rejecting valid
  short `%g` results from a conservative precision-derived output bound.
- The same required budget reaches printf, sprintf, CONVFMT/OFMT and comparison
  conversion. Existing integer fast paths, argument evaluation, redirection
  deferral, ORS behavior and Latin-1 byte semantics are retained. The internal
  `%08d` formatter control admits exactly 13 steps, rejecting 12 before padding;
  that is not a whole-command step count.
- This is deterministic work calibration, not hard CPU metering, native-call
  preemption, exhaustive native-operation accounting, or aggregate memory control.
  No CPU/RSS measurement or reproduction of historical audit magnitudes occurred.
- No production sed/shared-budget/parser edits, README/seal/boundary changes,
  new test literal paths, builds, broad gates, commits or pushes. No expansion
  into #576 filesystem quotas or #597 aggregate memory. Root retains registry,
  Git, full-gate and publication ownership. The owned code/test bytes are frozen
  for handoff; this is not a claim of integrated delivery or a successful release.

## Root-review follow-up: string numeric coercion

- September 4, 2026; inspected HEAD `982dbe563`. Root reproduced the remaining
  formatter-local gap with a 128-unit string of 127 zeroes followed by `1`:
  `%d`, dynamic `%*s`, and dynamic `%.*f` succeeded under maxSteps 64 because
  `number(string)` scanned and converted the prefix without length admission.
  The earlier native numeric-formatting charge did not cover this coercion.
- TDD RED: three new public `runVirtual` cases failed, each observing one
  `RegExp.exec` and one `Number(prefix)` before rejection was possible. One
  cached-scalar preservation test passed. The previous logs remain unchanged.
- The correction is a local `asNumber` admission function inside `formatted`:
  charge `value.text.length` only for `kind: "string"` before calling existing
  `number(value)`. Dynamic width, dynamic precision and numeric argument paths
  use it. Generic `number`, other coercion sites and runtime threading are not
  changed by this follow-up. Cached number/numeric/unset paths add no charge
  for untouched text; the numeric getter control throws if text is inspected.
- Positive public allowance at maxSteps 256 preserves `1`, `x`, and `1.5`,
  observing exactly one scan and one prefix conversion for each. Under 64 steps,
  all three reject with zero scans/conversions/output. Existing internal numeric
  `%08d` admission remains exactly 13 steps, with 12 rejecting before padding.
- Final GREEN: 59/59 selected tests (the original 55 plus four new cases), with
  zero failures/skips/cancellations/TODOs. The same 31 baseline numeric controls
  were rerun and matched. The selected test/type commands above are unchanged.
- An initial focused typecheck found a missing explicit return in the new test
  getter; it was corrected without production changes. The final focused strict
  no-emit check passes. The original failure log is retained, not overwritten.
- New private evidence: `575-coercion-red.txt`, `575-coercion-green.txt`,
  `575-coercion-types.txt` (initial getter diagnostic),
  `575-coercion-numeric-compatibility.txt`, `575-coercion-freeze-tests.txt`, and
  `575-coercion-freeze-types.txt`. These use the same prescribed Node 22/private
  TMPDIR/cache/color/Git-local environment and escalated execution as before.
- No README, registry, seals, shell runtime, generic numeric helper, sed, quota,
  aggregate-memory, or cap changes. No broad gates, builds or Git mutations.
  The current owned source/test hashes below supersede the historical freeze;
  all previous evidence and hash receipts are retained. Frozen for root handoff.

### Coercion follow-up frozen SHA-256 (historical)

- `packages/safe-bash/src/commands/text-programs/awk-values.ts`:
  `eb214b26cd1c8cdc759462e4d96708e4bea33ef96d9a1818f2e419aafe4e994e`
- `packages/safe-bash/src/commands/text-programs/awk-runtime.ts` (unchanged):
  `efe28b0aecd901eb0d9cfc1300fdb5314de6eab160083174ce7f4aab431e5f0b`
- `packages/safe-bash/tests/commands/text-programs/allocation-admission.test.ts`:
  `5f0cd33932278923755f7f8635f5e0fdc59f3ff2658635e5dc88179d1454bba8`

## Published upstream policy supersession: test-only reconciliation

- September 4, 2026: root identifies published upstream `cf517239d` as the
  stronger production policy, merged at inspected HEAD `3d3d2fa44`. Root reports
  the independent push and issue closure at 22:04:49Z. Its per-stage accounting
  and original optional internal signatures supersede this worker's earlier
  once-per-produced-output policy and 13-step `%08d` boundary. Original commits,
  historical hashes, tests and evidence remain preserved, not rewritten as current.
- Only `allocation-admission.test.ts` and this plan change in this reconciliation.
  No production, #576 implementation, registry, README, build, broad gate or Git
  mutation. The cached getter/no-text-read observer remains intact.
- Exact positive-unit arithmetic (zero-step cancellation checks add no units):
  `%08d` = scan 4 + native numeric rendering 1 + normalization 1 + positive-prefix
  construction 1 + width padding 8 + final concatenation 8 = **23**. Pre-padding
  work totals 7, so allowance **14** rejects before padding needs total 15;
  allowance **22** permits padding but rejects before final concatenation;
  allowance **23** accepts the complete format. Tests observe respectively zero,
  one and two cumulative padding calls, with abort preserving the final count.
- Cached scalar exact totals: `%d` = 2+1+1+1+1+1 = **7**; `%*s` = 3+1+1+1 = **6**;
  `%.*f` at precision 1 = 4+2+3+3+3+3 = **18**, while unset precision 0 gives
  4+1+1+1+1+1 = **9**. Each cached case now rejects at total minus one and succeeds
  at its exact total, without inspecting cached text. These are derived stage
  costs, not arbitrary increased allowances.
- Root RED is preserved at
  `/home/kjopek/kamilio-validation-569-575.RoFXyZ/575-576-merged-focused.log`:
  206 passes / two obsolete fixture failures. GREEN is **208/208**, zero failures,
  skips, cancellations or TODOs, in `575-576-merged-focused-green.log` beside it.
- The exact seven test files run with Node v22.22.0, `--import tsx --test
  --test-concurrency=1`: text-programs `allocation-admission.test.ts`,
  `awk-file-output-budget.test.ts`, `awk-format-integration.test.ts`,
  `awk-format-work-budget.test.ts`, `format-admission.test.ts`,
  `sed-file-output-budget.test.ts`, plus contracts
  `filesystem-direct-output.test.ts`. No name filter or omitted cases.
- Focused strict no-emit types rooted at the owned test file passed using the
  compiler flags recorded above; evidence is `575-576-merged-focused-types.log`.
  Fresh TMPDIR is the log directory's `tmp` child; TSX cache disabled, NO_COLOR
  unset and child Git-local variables cleared. All exec calls were escalated.
- Frozen test SHA-256:
  `02cfd994eb5cee3ec48162b25a2849e2d073e1af810abf378837a7292426d6a5`.
  Production was only read: merged formatter SHA-256
  `a0a485a38d7bdc0f9ce679881b752a789b0ad23bbcf8b2d2fc319827d05200dc`.
  Test-only correction is frozen for root build/lint/delivery; no further edits.
