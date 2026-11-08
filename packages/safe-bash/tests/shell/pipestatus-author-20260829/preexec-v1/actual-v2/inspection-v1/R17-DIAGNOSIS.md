# R17 SOURCE diagnosis: unsupported local-array declaration admission

**Do not change R17's expected stdout to empty.** Its exact frozen script contains `local -a`, not plain `local`. Native P23's local-indexed expectation is appropriate for that requested operation; the frozen product never establishes that indexed local. This is an unsupported-declaration admission gap, not demonstrated failure of publication into an existing indexed binding and not a P22 scalar golden typo.

## Exact frozen script

```bash
f(){ local -a PIPESTATUS; false | true; printf 'local=<%s>\n' "${PIPESTATUS[*]}"; }; f; printf 'outer=<%s>\n' "${PIPESTATUS[*]}"
```

The authenticated executable seal f61b8fb4 contains this exact R17 input, expected `local=<1 0>\nouter=<0>\n`, exit0. Actual-v2 retains `local=<>\nouter=<0>\n` in all three layouts. Original75 PASS/3 FAIL is unchanged.

## Frozen source path

The helper hash-authenticated the selected runtime against the seal, not live HEAD: `/private/tmp/safe-bash-pipestatus-corrected/candidate/src/shell/runtime.ts`.

1. Lines3521–3529 copy declaration argv and scan options **only for readonly**. There is no `local -a` option branch.
2. Lines3539–3541 process `-a` as a variable operand. It fails the identifier regular expression, emits `local: \`-a': not a valid identifier`, sets status1 and continues to the next operand. This diagnostic is SOURCE-derived here; the prior stdout assertion failed before later stderr/status assertions, so no new executed diagnostic observation is claimed.
3. The subsequent `PIPESTATUS` operand follows ordinary local handling. Lines3551–3567 replace an inherited indexed PIPESTATUS with a saved/restorable **scalar** local; lines3603–3605 also initialize an absent PIPESTATUS local to the empty scalar. Thus no indexed local is created by `-a`.
4. Authenticated `src/shell/pipestatus.ts:11` checks indexed store first, then own scalar; publication preserves a scalar target. The later pipeline therefore does not turn the empty local into an array. Normal function restoration and the function's numeric completion explain the agreeing outer0.

No new production defect in indexed replacement is established. `local -a` is a missing command form in this frozen profile; merely making the old stdout expectation empty would hide that unsupported surface rather than test the ratified local-indexed policy.

## P22/P23 and ROOT policy

Previously accepted native61913871/a0210531 observations remain finite local Bash3.2 evidence, not a new oracle run:

- P22: `declare -- PIPESTATUS=""` locally, then outer `declare -a PIPESTATUS='([0]="0")'`; stdout59B SHA256 `6c50f66ea0957474ae7a91541c13aff39db7c41ee13429c4143b0a1f6c14a387`.
- P23: local `declare -a PIPESTATUS='([0]="1" [1]="0")'`, then outer index0=0; stdout76B SHA256 `c0bff9f55c27954bae43621bf6fa34e31a863524884eb6513e376cef360c0b6d`.

The source helper recorded these existing `actual-run-v2/OBSERVATIONS.json` values and hashes. It does not re-certify native lifecycle/binary authentication: accepted audit a0210531 remains that authority. ROOT's preserve-visible-scalar / replace-visible-indexed policy is consistent with both; the issue is R17's unsupported way of requesting the indexed local.

## Minimal next step, not an applied correction

Prefer a **versioned supported-syntax fixture proposal**, keeping the original R17 and P23 gap literal: replace only `local -a PIPESTATUS;` with `local PIPESTATUS; PIPESTATUS=();`, preserving the expected local1 0/outer0 output. The explicit array assignment is intended to establish the local indexed binding before the pipeline; its actual admission/ownership must be checked in the proposed narrow continuation before credit. This proposal is UNRUN and is not permission to claim it works or silently alter the original case.

Alternatively, implementing proper `local -a` would require new declaration parsing/typed-local semantics and separate ROOT scope; it is not a small PIPESTATUS publisher correction. No source or fixture change was made in this diagnosis.

## Existing coverage and remaining hole

R16 uses plain `local PIPESTATUS` and passed all three layouts, directly covering empty scalar-local preservation plus outer restoration. R18 covers explicit empty scalar preservation. R03/R09 cover indexed vectors, including use inside a function but **not a local indexed shadow**; R14 covers readonly-index replacement. Existing private G03/G04/G11 cover indexed replacement/readonly/sparse cases; G08 covers local tombstone refusal. None of those proves public local-indexed shadow restoration. Original R17 was the sole such public intention and remains uncredited until a supported construction or separately implemented `local -a` is tested.

SOURCE/DATA-only: one captured Node helper, zero product/native/Workers/build/install/reruns;1,211,048 bytes read by that helper. Additional bounded source excerpts are retained externally in `/private/tmp/safe-bash-pipestatus-r17-source-detail.stdout` and `/private/tmp/safe-bash-pipestatus-r17-case-coverage.stdout`. The source-derived branch explanation is separate from the three directly observed stdout failures.
