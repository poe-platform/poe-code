# ROOT-qualified M1A acceptance: SOURCE/DATA type adjudication

Friday, August 28, 2026. ROOT adjudicates the intended missing-root-export
property from preserved v14 observations, without a compiler retry or changing
any historical test result, exit, product source or registration.

## Decision and authenticated observation

V14 evidence commit: `7dfde40f453b03d34fdc976eab1d36188c533aa6`.
Its original negative raw stdout SHA256 is
`eae2b77fc0d8aec5aad8fb90eafb5ecf90d935e1530e07d2f0f82f25c95640c3`.
The actual negative process exited1, with empty stderr, exactly one primary
TS2724 at line1/column9/start8/length16 for missing `createGitCommand`, the exact
sealed `createTarCommand` suggestion and one sealed supplemental TS2728 record.
There are no additional diagnostics; formatted bytes equal the frozen expectation.

The literal wrapper assignment at v14/compiler.mjs:90 maps any diagnostic to
`ts.ExitStatus.DiagnosticsPresent_OutputsSkipped` (1), then assigns that value to
process.exitCode. Wrapper SHA256:
`1c6a550d82f7801d0eacf9002125b523d6eda8faf82fc2b35f9cc694c613e502`.
Its field named `nativeExitCode` is an API-wrapper value, not a native CLI exit.
The expected2 was a CLI convention incorrectly applied to that wrapper. ROOT
accepts actual nonzero1 plus this exact diagnostic as the intended negative
property. No blanket acceptance of arbitrary compiler failures is introduced.

V14's sealed exit assertion still FAILS, its outer still exits1/SCOPED_FAILURES,
and v12's original TS2305 expectation mismatch remains. V13's positive harness
failure and negative UNRUN, including its secondary JSON parse failure, remain.
This new policy disposition is additive, not a rescore or a claim that any of
those coordinators exited0.

## Exact type and integrity bindings

- Negative consumer SHA256:
  `ed9ef7fc39f5d9d2c926d21fabd850fdeb8393a47b9ef37b48876b30b38f1b55`.
  Actual file bytes, logical path and compiler arguments remain unchanged.
- TypeScript5.9.3 public API entry SHA256:
  `3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`.
  Original CLI entry hash remains separately bound; this adjudication runs neither.
- Node22.22.2 SHA256:
  `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
- Actual options retain strict/exactOptionalPropertyTypes/noEmit=true and
  skipLibCheck=false. Positive companion emitted no diagnostics and exited0;
  its repeat is separate evidence, not a sixth intended type property.
- Both API reports recorded emitSkipped=false as observation only. The bound
  CompilerHost refuses output writes; authenticated recorded full work/source/tool
  censuses show no new emitted files or changed bytes/modes. Scratch was removed
  by v14 after guards. This DATA check does not recreate it or claim fresh runtime
  FS proof. Consumer/compiler hashes are checked directly; recorded source reads
  and guards are authenticated from immutable raw artifacts.

## Qualified module assessment; separate categories

ROOT qualifies Git M1A source
`9885390fb11454fa194a3e60fdbef198dbfdf633`, original derived base
`8437e4eda904e1248c25eeef0d9d455b1d251495`, full898-member package SHA256
`68541722217fb3f88f7317750c8f1a66042ea090f2c769564b9afc14372dfe68`.
This is the original M1A package composition, not all source at moving HEAD or
the later array-aware/M1B compositions.

- 284 unmodified semantic groups:71 each source, compiled, offline installed and
  moved; strict build/install bindings and cross-layout observations retained.
- Four original type passes: supported API consumer; refusal of public limits;
  refusal of native spawn injection; refusal of a non-string discovery boundary.
- Separately, the actual exact v14 missing-root-export negative is now accepted
  for its intended property by ROOT. These support five intended type properties
  through distinct evidence; they are **not a new aggregate5/5 or global green gate**.
- Three loaded-mutant detections, three fresh-child restores and three binding
  refusals remain historical separate categories, not rerun or added to284.
- Historical per-layout295 closed/destroyed/close-delivered stream objects and
  167 fulfilled registrations are observed quantities. Private-writer settlement
  remains SOURCE_LINKED_CONDITIONAL_JOIN, not an observed private-Promise timestamp.
  Untaken writer fallback/acquire/finalizer listener branches are SOURCE-only.

## Retained limitations and preservation

The bounded read-only M1A profile supports SHA1 loose objects, directory/bare
repositories, packed-refs and DIRC v2/v3. Pack/idx/promisor, alternates/shallow/
replace/grafts and unsupported formats, gitfiles/linked worktrees/commondir,
unsupported config/conversion/attribute forms refuse as specified. Empty canonical
objects/pack/info directories are not packed storage. Raw blob/name/quiet paths
are byte-based; text patches require the frozen strict UTF8/non-NUL subset,
unmerged selected diff and binary patches refuse, and rename/submodule/write,
extended pathspec/ignore/revision/rendering features remain unsupported.
Fixed caps and truthful provider metadata apply; no atomic race/rollback,
universal opaque-provider preemption, future-late-error, native allocation/RSS,
hard CPU or hostile-host isolation claim follows.

Native Git6 oracle workflows remain unrun. No full Git/native compatibility,
packed-readiness, M1B, root exports/default integration, current-HEAD/global gate
or superiority acceptance follows. Defaults78/root exports remain unchanged by
this record; Curie may integrate the accepted module only under a later assignment.

`authenticate.py` performs SOURCE/DATA file/hash/JSON checks only. `BINDINGS.json`
authenticates all121 v12,21 v13 and21 v14 committed artifact files and checks
current regular-file membership against those inventories. Binding SHA256:
`8cd6fa68667e1d2c60a095d80800c5b275a433f1f61b06de5b435ff69a1e7dcf`.
Old69/H09STOP/215UNRUN and289/288, v11 zero/284 with partial transcription, all
qualifier failures and every later raw exit remain preserved. No new subject,
compiler, native-oracle, product/private/network execution or cleanup occurs here.
