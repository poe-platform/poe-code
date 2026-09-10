# Bounded GNU factor

Continue the oldest remaining requested utility issue after verified remote-main
delivery of tsort and the pr readable-device follow-up. Issue #682 explicitly
allows a magnitude cap or bounded BigInt with a work budget; do not claim the
native implementation's complete integer domain when selecting a smaller cap.

## Reference and implementation

Read the complete pinned GNU coreutils 8.30 utility and its token reader before
implementation. The Ubuntu patches-applied commit is
`26a1fa64acd11d62b28a59fab6b938ab57d12ba7`; factor.c SHA256 is
`854f7a201d08d20f6fafb17f1ad0903f85bce0cab3247ac6510230283600e4f4`.
Preserve the native captures under `/tmp/issue682-factor-oracles-mmtoko` and the
author scratch TDD evidence under `/tmp/issue682-factor-author-Mtz2gp`.

Use exact integer arithmetic with a documented configurable maximum no greater
than 4,294,967,295. Bounded trial division avoids probabilistic results and a
new dependency. Charge work and yield cooperatively during parsing/division;
bound arguments, tokens, total input, number count, retained storage, output
and diagnostics. Larger otherwise-valid values produce a clear cap diagnostic,
not a fabricated factorization or a native-overflow claim.

Preserve native argument/stdin selection, token delimiters, canonical numeric
printing, 0/1 behavior, factor order, invalid-operand continuation and status,
option parsing, raw-byte diagnostics and recorded NUL-prefix token behavior.
Input/output ownership, falsey cancellation and registered cleanup use the
existing public contracts. No host process, network, ambient filesystem or LLM
is part of the command implementation.

## Ownership and integration

The implementation worker owns only `src/commands/factor`, author tests and
`docs/FACTOR.md` within safe-bash. Independent tests have a separate directory.
Root owns exports, composition, public tests and this plan; the inventory worker
updates existing current exact counts and packed consumers, preserving sealed
history and all earlier utility/cleanup canaries. No README additions.

Expose `createFactorCommand`, `createFactorCommands`, `factorCommands`,
`FactorCommandsOptions` and `FactorLimits`. Append factor after tsort, yielding
95 default commands. Aggregate options forward only limits and never consult a
nested replacement setting. Root/scoped Node and co-bundled browser/workerd
subpaths retain public factory identity.

## Acceptance and delivery

Record missing public behavior before wiring. Run memory-only author and
independent tests against maintained paths; scratch checks alone are not the
final qualification. Compare finite native stdout/stderr/status fixtures exactly
and label cap/banner differences explicitly. Exercise an actual saved VFS script,
both argument and stdin modes, partial failure, and public limits.

Register literal test paths, inspect terminal output visually, run maintained
full tests and lint, then the final normal build, types, committed archive,
package lint and fresh packed consumers. Freeze and verify current inputs and
preserve every failed attempt. Commit atomically, verify remote main before
closing #682, and monitor actual publication while continuing to #683.

## Public TDD evidence

Before wiring, `/tmp/issue682-public-red-v2.log` records three actual individual
failures for missing default/public factories, a saved argument/stdin script and
invalid-operand continuation. The first sandboxed attempt only reported one
file-level failure and is retained separately, not counted as behavioral evidence.
The public suite also checks aggregate magnitude forwarding and a nested
replacement getter that must not run.

All four public tests pass after maintained-source integration in
`/tmp/issue682-public-integrated-v1.log`. This is focused source evidence only;
independent review, inventory qualification and broad/final gates remain pending.

## Validated review corrections

Independent maintained tests first record 16 getter-cancellation admission
failures (nine other cases pass) in
`/tmp/issue682-factor-independent-repo-red-v1.log`. The author adds matching
regressions, preserves `/tmp/issue682-factor-getters-red-v1.log`, and checks
cancellation after acquiring iterator factories, iterator methods and output
capabilities/methods before calling them, preserving their original receiver.

A separate native comparison validates GNU's ambiguous `--=x` diagnostic;
`/tmp/issue682-factor-ambiguity-red-v1.log` retains its pre-fix failure. The
corrected maintained author suite passes 126 cases in
`/tmp/issue682-factor-maintained-v2.log`, with focused types passing. Independent
retest and the possible cross-command extent of getter admission remain under
review; this record does not declare those checks complete.

The final independent factor suite passes 91 cases in
`/tmp/issue682-factor-independent-green-v1.log`, with focused types passing in
`/tmp/issue682-factor-independent-types-v3.log`. Its original output-cap fixture
incorrectly expected a first batch already to be published at cap 511. The
documented writer may discard pending unflushed records on fatal budget failure.
The corrected test uses 172 rows and cap 514 to test a previously published
batch, and separately preserves the original cap-511 no-output control. The
original red remains recorded; this correction makes no product change.

The getter issue extends to pr and tsort, with a separate tested atomic follow-up
in `docs/plans/command-getter-admission-20260910.md`. Both existing issues are
reopened until that follow-up reaches verified remote main. The unrelated
Toolcraft attestation-propagation CI failure has its own workflow-only fix and
plan, not a command workaround or a waived signature check.

Final current inventory source checks pass 633 cases; source/mock public checks
pass 47 cases, including eight new direct-factory getter canaries. The earlier
mock red is preserved in `/tmp/issue682-public-getter-source-v1.log`, and green
in `/tmp/issue682-public-getter-source-green-v1.log`. The 25 inventory/fixture
paths are frozen in `/tmp/issue682-fixture-final-v2.sha256`. Existing statements
inside the extended pr fixture and the other ten prior fixture functions remain
unchanged. The normal refresh build passes in
`/tmp/issue682-build-refresh-v1.log`; final broad tests/build/packed validation
still follow the complete candidate commit.
