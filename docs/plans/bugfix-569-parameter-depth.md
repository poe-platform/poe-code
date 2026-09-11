# Issue #569: parameter operand depth admission

## Scope and baseline

- September 4, 2026: baseline `070c762bde2bda8dd46da28d23d14873fc1326f2`, initially clean.
- Confirmed issue #569 author `kamilio` and full body through `gh issue view`.
- Initial parser assignment: own `packages/safe-bash/src/shell/parser.ts`, the new unsealed
  `packages/safe-bash/tests/shell/parameter-depth.test.ts`, and this plan.
- Root registers the literal test path, owns Git, builds, full gates and releases.
- No deep/generated nesting, raw stack-error reproduction, stress probes, or
  claims that the issue's reported crash thresholds were reproduced.

## Design

1. RED: hand-written one/two-level operands use the existing public initial-depth
   argument near 64, keeping actual recursion small.
2. Track active parameter operand depth plus inherited lexer depth. Admit before
   operand descent at the inclusive limit of 64; restore active depth in `finally`.
3. Carry active operand depth into both command-substitution parser forms.
4. Preserve quoting, arithmetic, deferred heredocs, legacy signatures, cancellation
   identity, and #565 cumulative parse-unit accounting.
5. GREEN: focused bounded tests and no-emit types; record source/evidence hashes.

## Initial runtime proposal and subsequent handoff

The issue explicitly requires a runtime mirror; the initial parser-only phase was
not sufficient to close it. Runtime ownership initially belonged to #574, so that
phase left runtime unchanged and proposed independent per-evaluation-chain depth
admission for alternates, pattern/replacement and substring operands. Root later
approved an immutable IO-local context and transferred runtime ownership after
committing #574 as `982dbe5637d416dd7fa113c708f6fe5defb5dd21`. The completed runtime
phase is recorded below. No runtime-global counter or `RangeError` catch is used.

## Parser-phase validation evidence

Parser implementation and focused validation completed; parser source/test files
remain frozen for root. Other workers' concurrent changes were left untouched. HEAD remained
`070c762bde2bda8dd46da28d23d14873fc1326f2` through these checks.

### Environment and commands

All exec calls used `require_escalated`. Test/type children used Node `v22.22.0`,
the assigned toolchain and private temporary directory, and this child-only setup:

```bash
export PATH="$(cat /tmp/kamilio-toolchain.path)/bin:$PATH"
export TMPDIR="$(cat /tmp/kamilio-561-562-tmp.path)"
export TSX_DISABLE_CACHE=1
unset NO_COLOR
while IFS= read -r variable; do unset "$variable"; done < <(git rev-parse --local-env-vars)
```

Initial RED, before production changes, and initial GREEN:

```bash
node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/shell/parameter-depth.test.ts
```

Final focused validation, including two additional precise admission/accounting
assertions and ordinary parser/#565 regressions:

```bash
node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/shell/parameter-depth.test.ts packages/safe-bash/tests/shell/parser-regressions.cases.ts packages/safe-bash/tests/shell/parse-budget.test.ts packages/safe-bash/tests/shell/parse-admission.test.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node packages/safe-bash/src/shell/parser.ts packages/safe-bash/tests/shell/parameter-depth.test.ts
```

No builds, full gates, lint, native comparison, crash/stress probes, Git mutations,
commits, pushes or releases ran. The explicit-root no-emit check covers the two
roots and their imported types, not the maintained full consumer/type gate.

### Results and logs

Evidence directory:
`/var/tmp/poe-code-kamilio-561-562.dFKZCV/issue-569.6lAcsr`.

- `red.log`: exit 1; 29 tests, 6 pass, 23 fail, no skips/cancellations. All failures
  were missing expected depth exceptions, not stack errors or process crashes.
- `green.log`: intermediate exit 0; 29/29 pass.
- `focused.log`: final exit 0; 54/54 pass (31 new, 23 existing), no skips or
  cancellations; total reported duration 2615.896526 ms.
- `types.log`: exit 0, no diagnostics.
- `git diff --check -- packages/safe-bash/src/shell/parser.ts`: exit 0.
- `before.sha256` records baseline inputs; `preserved.sha256` verifies six
  selected non-owned inputs unchanged. This is not a repository-wide freeze check.

Log SHA-256:

```text
d9113e2b4fdb7db34ad168f89dc8a87e4584c3706a6068788e886c5fae6eac67  red.log
c19517825d8dcd31d7d23845a7dc9dd6987c96ccb0d8684ea34056c84e43c9e8  green.log
f2e9ee7189b78f7f051fbebe005e4954285bd926a6a746142d392f1bffe7c3c9  focused.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  types.log
```

### Frozen hashes and registration handoff

Final owned source/test SHA-256:

```text
fc501435a5a159f03a47ea1c84dff0fefaa3417730d33edc5b4280863c737981  packages/safe-bash/src/shell/parser.ts
b1bdd6fc6199955034f66c1fd6e4409159233a6c620fe95fe0bc6658e271aa7d  packages/safe-bash/tests/shell/parameter-depth.test.ts
```

The baseline parser hash was
`484925e14ddf655be42614a20cfcdd0a40527e56b5512d4e9a44a893de1de7cb`.
Verified unchanged baseline inputs:

```text
beda52c886719ce1c91ddfb3f778f1d40e4d9c1f7c5d2aa49176922beebcc115  packages/safe-bash/src/shell/parse-budget.ts
472aaeb11f94d053a03caf14736033458ba7a0564fe0508c5aefc3f74e601761  packages/safe-bash/tests/shell/parser-regressions.cases.ts
b577b9ef5cce4ade09a28c2e0e10122526935a4ac5843b397c59b0dc1f643266  packages/safe-bash/tests/shell/parse-admission.test.ts
b6cc09a2a9ab098d72cb2d54ef92f65b26edac6544ec3de64a3041167bd5344d  packages/safe-bash/tests/shell/expanded-gaps-cases.ts
eee939985b59feb7236bfb7aabbe1046b1e2c0936b3d4fa53f537484dfe5e95f  packages/safe-bash/tests/shell/expanded-gaps-native.json
e886e25f613dd195701189c33e82c6bbfd7736168e65165849b77f8008775fde  packages/safe-bash/scripts/integration-inputs.test.mjs
```

The parser-phase registration request was `tests/shell/parameter-depth.test.ts` in
the package's `scripts/integration-inputs.test.mjs`. No sealed test, fixture,
manifest, README or registration file was edited.

## Completed runtime phase

### Baseline, ownership and behavior

- Root transferred runtime ownership on baseline
  `982dbe5637d416dd7fa113c708f6fe5defb5dd21`; HEAD remained there through checks.
- Verified and snapshotted committed #574 runtime bytes as `runtime-574.ts`, SHA-256
  `729be35bd7dde86349280b82d56ca56c2881276fe868f0fd32bce3683f1c728f`.
- Added only `tests/shell/runtime-parameter-depth.test.ts`, edited `src/shell/runtime.ts`
  and this plan. The earlier parser source/test stay byte-identical.
- Immutable child IO carries active operand depth. Admission checks cancellation
  first, combines operand depth with inherited `state.depth`, and rejects past 64
  with `ShellSyntaxError` and the operand offset. No public signature changes.
- Each evaluated scalar/indexed alternate, pattern, replacement, and substring
  offset/length gets its own child context. Parent IO is never mutated, including
  across failures and overlapping evaluations. Unused alternatives stay lazy.
- Tests exposed an additional iterative alternate-flattening path in `valueWord`:
  its queued entries now retain individual IO contexts, admit before copying an
  alternate, and pass that context into `valuePart`. Existing quote/split handling
  is unchanged; a `partValue`-only patch would have been incomplete.
- Substitution checks retain existing `maxSubstitutionDepth` failure precedence,
  then enforce combined depth when a parameter operand is active. Existing child
  state depth increments exactly once; capture IO preserves active operand depth.
  Standalone substitutions retain explicitly larger existing configured limits.
- #574 scanning, matching, string materialization and cleanup algorithms were not
  rewritten. Existing string-operation controls pass unchanged.
- Direct handwritten AST tests establish independent runtime admission, rather
  than relying on canonical parser rejection. No crash/deep-generated/stress
  inputs, production builds, full gates, lint, Git mutations or releases ran.

### Runtime commands and evidence

Evidence directory:
`/var/tmp/poe-code-kamilio-561-562.dFKZCV/runtime-569.iNGgDf`.
All commands used the same assigned Node 22/private-TMPDIR environment documented
above, `TSX_DISABLE_CACHE=1`, unset `NO_COLOR`, and child-only Git-local variable
clearing. Every exec required escalation.

```bash
node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/shell/runtime-parameter-depth.test.ts
node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/shell/parameter-depth.test.ts packages/safe-bash/tests/shell/runtime-parameter-depth.test.ts packages/safe-bash/tests/shell/parser-regressions.cases.ts packages/safe-bash/tests/shell/parse-budget.test.ts packages/safe-bash/tests/shell/parse-admission.test.ts packages/safe-bash/tests/shell/parse-admission-runtime.test.ts packages/safe-bash/tests/shell/string-operations.test.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node packages/safe-bash/src/shell/parser.ts packages/safe-bash/src/shell/runtime.ts packages/safe-bash/tests/shell/parameter-depth.test.ts packages/safe-bash/tests/shell/runtime-parameter-depth.test.ts
```

- `red.log`: before runtime edits, 4/26 pass and 22 fail. A fixture's unreachable
  Capture decoding calls were corrected to use its actual `bytes()` API; the
  corrected pre-production rerun `red-corrected.log` retains 4 pass/22 fail.
  `red-types.log` confirms the corrected fixture passed strict types against #574.
- `green.log`: intermediate 7 pass/19 fail, exposing the additional flattened
  alternate path. Preserved as incomplete evidence, not a passing result.
- `green-flat.log`: after fixing that path, 26/26 pass, no skips/cancellations.
- `focused.log`: final 147/147 pass, no skips/cancellations; 1530.277411 ms reported
  total duration. Includes both new depth files plus ordinary parser/#565/#574 controls.
- `types.log`: final strict no-emit check exit 0, no diagnostics; not a full gate.
- `runtime-depth.patch`: runtime-only diff against the committed #574 snapshot.
- `preserved-check.log`: six selected parser/#565/#574 source/test hashes unchanged.
- `git diff --check` for both owned source files exits 0.

```text
18967d8f131053403f3ad3c91458796e4b567a8afbe992f3f4712a115200852f  red.log
5dd6e5088dde69983761989f9281e364a90c556009bbe930ac7020c5e713c3e7  red-corrected.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  red-types.log
2fc7d8b01f37373289921143f90fd07d32f197df61105dccc9b026bd723d003b  green.log
2487ce72f70d64639615559ea417a7cd21c61314eb6b80f7b5ee19dc00f9e03e  green-flat.log
3f1f4a60f3a99885565506ff588c700adbfe56af2bf8da114abbdb45b19e607e  focused.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  types.log
99c02859783ffa7ffc394cc1d802e882b99aeaa41d9e9c07622622ea6d945bcd  runtime-depth.patch
```

### Final freeze and root handoff

```text
88dcc03fe0328d8f890592efa5c9d495ae9a2dd6d9eddb883711613096d86322  packages/safe-bash/src/shell/runtime.ts
c69b3422b63f2ae2f32730a314873406967d6e5c54b7b55c107d57dc69577d93  packages/safe-bash/tests/shell/runtime-parameter-depth.test.ts
fc501435a5a159f03a47ea1c84dff0fefaa3417730d33edc5b4280863c737981  packages/safe-bash/src/shell/parser.ts
b1bdd6fc6199955034f66c1fd6e4409159233a6c620fe95fe0bc6658e271aa7d  packages/safe-bash/tests/shell/parameter-depth.test.ts
```

`final-owned.sha256` in the runtime evidence directory also records this completed
plan's hash. Source and evidence are frozen for root; no further edits are planned.
Root registers both literal paths `tests/shell/parameter-depth.test.ts` and
`tests/shell/runtime-parameter-depth.test.ts` in the package test inventory, and
owns review, Git, full gates and delivery. No commits or pushes were made here.
