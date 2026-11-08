# Preparation v2 handoff — scoped qualification, readiness exception A01

Recipe commit: `0a02e846b3f4985cad4394187717ceabd0188f25`.
Recipe manifest: 8,935 bytes, SHA256
`8ed0cccb9edcff563bb01c45ee3942becaf7084754e18beef1e793bac049dfb8`.
The evidence commit is the commit containing this file and EVIDENCE-SEAL.json;
its full SHA is reported in the final response rather than embedded circularly.

## Actual single qualification

- Started `2026-08-28T05:32:33.591Z`; ended `2026-08-28T05:32:37.298Z`.
- **3,022 qualified / 0 failed / 0 unrun; zero retries.** These are synthetic
  validator/helper controls, not product case passes or a superiority claim.
- **8/8 children reaped.** Four natural positives: ordinary success, finite large
  stream, SOURCE, physically moved installed executor. Two ordinary negative
  outcomes: exit 7 and a durable exit 1 for the required-missing-phase aggregate.
  Two intentional kill controls: raw overflow and timeout, separately classified.
- Each SOURCE/moved child completed 577 synthetic assertions: 264 direct
  case/schedule jobs, eight flag variants, 109 finite scenarios, 48 resource trace
  jobs and 148 guards. Each separately reported six unreachable recipe targets;
  those six were not assertion passes. Nested counts are not added to 3,022.
- The 32 diagnostic matchers have 192 predeclared positive/negative controls,
  including actual wrong diagnostic content and wrong argv context.
- The 18 generators have 144 boundary/ledger/configuration controls plus ten
  resource extras. Defaults/ceilings remain exactly frozen, not raised by the
  small synthetic parameters. No default-scale resource acceptance is claimed.
- Preseal syntax checks included one corrected duplicate local
  binding; this is disclosed in PREPARATION.md. No qualification occurred before
  sealing; no expectations or code changed after the seal or after this run.

## Raw evidence

EVIDENCE-SEAL.json: **8,765 bytes**, SHA256
`d0dbb6a36c9cb9a6b7af229b2f32c8cb11d0152f227de015955c19a2133c4b37`.
It binds **41 regular files / 12 directories / 7,792,865 artifact bytes**, with
append-aware checking of original and newly introduced entries. No empty
directory needs an external transport to survive a checkout.

The streamed control log is 1,597,759 bytes, SHA256
`4d2fdcfc5c8d5a9bbcdd411c8bde5468c4099775c6a9a538c5143d33ceb0e909`.
The finite large raw stream is 5,242,897 bytes. Supervision separately records
full-delivered hashes, retained artifact sizes/hashes and overflow/truncation;
CLI previews and ordinary logs remain bounded. No giant JSON or RSS claim.

## Prepared coverage and remaining work

All **88 prior references / 12 control families / 18 recipes / seven
ratifications / 36 selectors** are pointer/hash-bound to executable assertions,
scenarios or generators. The 14 ratification case bindings remain explicit;
selectors are **21 valid / seven S+N / eight R**. Cases execute against trusted
synthetic command/driver fixtures only. The actual 88 candidate references and
all candidate acceptance cases remain **UNEXECUTED**.

PREPARATION.md contains the G01–G08 implementation/prerequisite matrix and full
adapter/admission/build protocol. **READINESS-AUDIT.md adds a genuine remaining
candidate-independent omission A01:** the future `run-candidate` parent checks
exit/reaping/integrity but does not validate required-phase/complete/closed
receipts or stop the next layout on an incomplete cleanup-broken phase. Its
generic helper and synthetic paths are qualified; their integration into that
actual parent is not. This is not caused by unknown product APIs and must not be
called a candidate-only prerequisite or a policy hold. Do not route candidate
acceptance through this recipe until an authorized new additive recipe fixes and
qualifies that exact path. The sealed recipe is intentionally not patched or
rerun after this discovery.

After A01, candidate-only prerequisites are root authorization; full immutable
candidate/base/tree/delta; actual factory/options and candidate-local registration;
reviewed source/lifecycle/work/capacity/FsError adapter; authentic selected
build/pack/tool/consumer receipts; and SOURCE plus physically moved layouts.
The base remains `5137a74ec855a32d8a8860eb66b62eb44d11e290`, registry 77 and no
public XAN export. No new grammar approval is needed.

**XAN source inspection 0; product execution 0; native execution 0; builds 0;
typecompiles 0.** Shared contract declarations and preparation helpers were read,
not executed as product. V1/Dirac are unchanged; the historical V1 74 controls,
21 children and native 28+16 observations are neither rescored nor new passes.

## Safe commands now

```sh
node tests/commands/xan-module-review-20260828/preparation-v2/run.mjs verify-recipe 0a02e846b3f4985cad4394187717ceabd0188f25
node tests/commands/xan-module-review-20260828/preparation-v2/run.mjs verify-evidence 0a02e846b3f4985cad4394187717ceabd0188f25 d0dbb6a36c9cb9a6b7af229b2f32c8cb11d0152f227de015955c19a2133c4b37
```

Do not rerun qualification. The conditional `admit-candidate`, `run-candidate`
and `run-selected-build` protocol is documented and executable, not an
unconditional placeholder throw, but actual product use remains unauthorized
and A01 prevents claiming complete preparatory readiness. Finish this handoff
without waiting for candidate files or starting inspection.
