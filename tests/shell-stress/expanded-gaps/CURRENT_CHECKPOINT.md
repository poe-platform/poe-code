# Current three-gap checkpoint — documentation consolidation

Consolidated August27,2026, at03:47 UTC from existing committed reports and raw
artifacts. All times below are UTC; Git's August26 evening timestamps in
America/Chicago refer to these August27 UTC events. This is documentation-only:
no tests/native controls rerun, no source lease acquired, and no existing source,
tests, expectations, artifacts, exports, contracts, dependencies or benchmarks
changed. Counts are cohort-specific, not an aggregate completion score.

## Source checkpoints and provenance

The three-gap source checkpoint consists of these full commit IDs:

| Commit | Committed August27 UTC | Bounded increment |
| --- | --- | --- |
| `d904cf86ec7ebcb2fb4113e5e31db1c976023716` |03:10:00| Isolated headerless VFS executable fallback |
| `e64ce50e1e45c6cf5e3e3686ce7424cbf0fa50df` |03:10:38| Recognized virtual env bash/sh shebang bindings |
| `0f5dbb3b5c65f773eada40876fa18098c36a5fbd` |03:17:59| Bounded scalar replacement/removal and final handoff |

At that READY checkpoint, source write authority was relinquished. Verified
runtime SHA-256:
`fc8b4fc043068c2b8ad5efbb0a7100720424e307f54c8574bdf901a99aecd29f`;
parser SHA-256:
`28492059750ba7f11fad563dfc03dba049f232b3f2212186cf3553e4559ae905`.
The independent seven replay checked all10 committed/current shell files and
actual parser/runtime imports. Later output accounting is a **separate source
checkpoint**, described below; do not assign its runtime bytes to0f5dbb3.

Author evidence: `tests/shell/expanded-gaps-README.md` and
`tests/shell/expanded-gaps-validation.json`. It records **58/58 TAP**:45
native-backed cases plus13 host tests. One bounded-child TAP row contains10
internal assertions; this is not68 tests. Both full45 native profiles were
captured by the author: **45/45 GNU5.3**, **43/45 historical Bash3.2**. The two
historical losses concern quoted/unquoted replacement ampersands and remain
visible. Independent nearby verification references this author evidence by
hash; it did not independently recapture those45 cases.

## Independent seven and nearby holdouts

The unchanged seven's chronology remains **0/7 → 3/7 → 6/7**, not rewritten
history. Original11 files at `5cfb70a` and postfix5 files at `b439dd9` remained
byte-identical during the final replay. Evidence commit
`3b832d94d41b5a67fb3d9f9948ce6587a743cc1f` and
`tests/shell-stress/expanded-kernel/GAPS.md` record the final capture at
03:20:26.547–03:20:30.728, HEAD
`0d625f3348b883593e89b1c7eec70b7df9324f12`, shell0f5dbb3/runtime hash above.

Headerless `ran:argument`, env-shebang `env:argument`, and combined parameter
`abc:abc:XbcXbc` newly match empty stderr/status0/exact file effects; source,
dot and eval retain their previous passes. **Type remains the exact loss**:
`command\ncommand\nfunction\n` versus native
`builtin\nfile\nfunction\n`, with matching status0/empty stderr/effects.
This is a truthful registered-implementation role difference, not automatically
a parser/dispatch bug; no registry command is relabeled builtin to gain a pass.

That leaf freshly executed **both complete seven native profiles**, each7/7;
current virtual is6/7 against either. The unchanged env-shebang fixture used
actual `/usr/bin/env` with the original profile PATH bindings, and controls
proved actual5.3/3.2 child versions. It did not substitute per-case oracles.
All161 capture source files and130 actual source imports were stable; later
unimported foreign S3HTTP index/request additions are separately recorded.
This is not clean whole-tree or aggregate-product certification.

The distinct nearby verifier's `ACCEPTANCE.md`, `ready-0f5dbb3.json` and
`acceptance-audit.json` cover03:23:42–03:24:18 on August27. Its unchanged
36-row native references are **reused**, not freshly rerun. Current raw exact
matches are **29/36 primary**, **28/36 historical**. Host assertions are
**10/10**, but only **9/10 guard-valid**: `host-source-budget` was invalidated
by newly appearing foreign `src/fs/s3/http/transport.ts`, despite all130 actual
source imports matching and that file not being imported. Therefore strict
acceptance is **38/46**, not39/46 or a clean46-row aggregate. No retry or guard
exception removed that invalidation.

Seven exact native losses remain: unreadable-file diagnostic wording; Darwin
env-option execution versus virtual rejection; env-injection/missing-target
status differences; missing-interpreter diagnostic wording; substitution-created
marker mode0644 versus0666; and unsupported substring syntax. The injection and
missing-target category contains separate rows. None becomes a skip or proof
that entire headerless/env/parameter feature families are closed.

## Original72, raw57, and CORRECTED72

`ACCEPTANCE.md` remains the historical pre-migration report: original holdout
**71/72 on0f5dbb3**, with only `path-headerless-policy` failing its obsolete126
expectation. Earlier original72/72 is preserved. Its statements that corrected72
was blocked/not run describe that earlier checkpoint, not the later migration.

The latest raw57 comparison **in that report** is **52/57 primary +50/57
historical**, versus earlier **51/57 +49/57**. All57 current tuples came from
the fresh original72 run and were compared against **reused whole native57
references**. The newly exact headerless result accounts for the increase.
These are not fresh native captures or revised raw57 oracles. The documented
TAP-escaped-JSON postprocessing failure was repaired by decoding retained
child.stdoutHex; no product rerun or raw evidence was discarded.

Subsequent test-only commit
`7d329e0e78a731676aaf76b3e5fd15e712212b6f` at03:34:41 authorizes the minimal
migration documented in `legacy-headerless-migration.md` and its evidence JSON.
Exactly one case loses `scope: "policy", policyStatus: 126`; these inputs remain
unchanged:

```text
ID: path-headerless-policy
source: PATH=tools; invtool
fixture path: tools/invtool
fixture body (JSON string): "printf 'native-fallback\\n'\n"
mode: 0o755
```

The normal assertion branch now compares the **full native tuple against both
frozen profiles**: status0, stdout `native-fallback\n`, empty stderr, empty
namespace-effect map. There is no0-or126 allowance. Fixture SHA-256 remains
`b7441278de4509d4fe9cf4dad592fb2ce8edb5887fae485ea10fe66980c40630`.
No other71 case definitions or57 native input identities/reference rows change.

The migrated `invocation-modes/holdout.test.ts` pins only two whole cases files:

- Original cases SHA-256:
  `788539627f6f5d8a8b31702ec3b9c7a6477efe8878fa88fa7fd0ae955553ed3b`.
- Exact one-row revised cases SHA-256:
  `fdc22c27541f4f29334274e35238c22fa4645730dbe5239134a585ee8e03f83c`.
- Unchanged full native artifact SHA-256:
  `86e6be4ec1ad22f3c5956ed0b37d8091653c4858fbf143f35b2e80eae4b67e45`.

Native `cohortHash` stays pinned to the original cases hash. The full native
artifact is checked before parsing; no current-file-derived expected hash,
normalization, or broad acceptlist is introduced. Eight guard controls accept
the two pinned files and reject six mutations without modifying real fixtures.

**CORRECTED72 ran once,72/72**, at03:33:13.165–03:33:23.346. Its34 actual
product imports/39 repository inputs were stable; scoped typecheck used168
inputs and exited0. This run used the accounting author's **dirty runtime**,
SHA-256
`c7c9d02ddde5576b7810bfecbbd21b70c6eb2c0ea4fe1ee8bee92c21946d8449`,
with the unchanged parser hash above. Last committed runtime was0f5dbb3, but
these were not0f5dbb3 bytes. They were later committed in f7000b0. Thus corrected72
is neither an unchanged-original rerun nor output-accounting acceptance. Preserve
the original71/72, earlier72/72, blocked revision proof, and corrected72 separately.

## Separate entrypoint41 revision

Commit `f3f407542de5fb9447518615312166f4b4ce8e70` at03:27:04 is a different
test-only correction: `tests/shell-stress/entrypoint-policy-review/README.md`
records author **39/41 unchanged → corrected41/41**, while independent17/17
remains unchanged. It is not the invocation72 migration.

Exactly two old rejection rows, plain and env, retain bodies `say bad` and
`#!/usr/bin/env bash\nsay bad` with no final newline, mode0755 and executions.
They now require status0, exact `bad\n`/hex6261640a, empty stderr and unchanged
bytes/modes/namespace. The other five rejection rows and all other author controls
remain; all17 holdouts are byte-identical. Fresh whole affected native proof is
**4/4**: two original bodies × two actual profiles, not reused57 or45 evidence.

Baseline window03:23:20.691–03:23:24.949 and corrected window
03:25:29.944–03:25:35.646 used0f5dbb3's runtime
`fc8b4fc043068c2b8ad5efbb0a7100720424e307f54c8574bdf901a99aecd29f`.
Actual imports and scoped typing passed; endpoint checks do not rule out
transient write/revert or establish a clean aggregate. Historical earlier58/58
and corrected41+17 are distinct evidence, not relabeled old proof.

## Output accounting is a separate pending review

Later production commit `f7000b05b15fa34371226b35cf537d3f73bbf004` at03:35:41
changes runtime accounting, not the three-gap feature definitions. Its committed
runtime SHA-256 is
`c7c9d02ddde5576b7810bfecbbd21b70c6eb2c0ea4fe1ee8bee92c21946d8449`;
parser remains28492059… as fully pinned above. See
`tests/shell/output-accounting-README.md` and its validation JSON.

Author evidence is **29/29**:28 direct actual-Shell tests plus one bounded-child
TAP row containing nine assertions, not38 tests. The preserved red observation
is13 pass/14 fail out of27. Final global/build/benchmark noEmit each exit0 on
1069/302/411 guarded compiler inputs. These are author worktree evidence, not
independent acceptance. Author regression415/415 uses the separately corrected72;
it does not erase the older414/415 or original71/72.

**Plato's independent eight-case accounting review is PENDING at this
consolidation.** Do not promote author29 or compiler exit0 to accepted accounting
closure, or merge a custom host-accounting policy with Bash-native parity. No
new lifecycle/output policy API is implied by this checkpoint.

## Remaining boundaries

Supported virtual interpreter bindings do not establish general env/options,
arbitrary interpreter or kernel parity. Fatal UTF8/binary handling, whole-file
prevalidation and bounded scalar/code-point/ASCII-class matching retain their
documented limits; no full locale/extglob/array/substring/shopt coverage follows.
Native primary/historical ampersand and nearby losses remain denominator losses.

Old9 diagnostics and five custom-first-read lifecycle cases remain separate.
An independent old9 rerun is underway; **this document assigns it no current
count or closure**. The five custom cases are not closed by accounting author
results. Other ongoing backend/WebDAV, environment, BOM/jq and whole-product
work is not certified here. No full224/baseline replay, full feature-family
closure, overall kernel parity, full Bash, superiority or72-hour completion claim.

## Addendum — independent accounting acceptance, August27,2026

The earlier **PENDING at03:47 UTC** statement remains historical. Plato's later
independent acceptance `1f2aa307bd1a6e2abe0508369e70c7295ffdf263` (03:50:34 UTC)
reviews the complete frozen source `f7000b05b15fa34371226b35cf537d3f73bbf004`,
runtime SHA-256
`c7c9d02ddde5576b7810bfecbbd21b70c6eb2c0ea4fe1ee8bee92c21946d8449`.
See `tests/commands/core-regression-stress/OUTPUT_ACCOUNTING_REVIEW.md` and
`tests/commands/core-regression-stress/NORMATIVE_PROFILES.md`.

All **eight original budget failures now pass8/8**, and the nine original budget
controls remain9/9. Original accounting18 is **17/18**, not18/18: the unchanged
Apple environment-order row remains the sole exact loss, not a budget failure.
Separate evidence is core100/100, original recipes6/6, runtime acceptance10/10,
focused cohort111/111, new accounting guards8/8, detected semantic mutants7/7,
and independently rerun author29/29. The initial guard-probe6/7 mutant observation
remains recorded beside the strengthened probe's7/7; no source fix or old
expectation change was needed. This accepts the bounded accounting repair,
not broader lifecycle, shell, or product parity.

The retained order difference is virtual/pinned GNU `B=2\nA=1\n` versus Apple
`A=1\nB=2\n`. That GNU9.7 capture is specifically **Darwin/libSystem with
gnulib rpl_putenv prepending new names**, not universal GNU/Linux behavior.
POSIX gives environment-string order no meaning; these fixture maps agree even
though exact bytes differ. No Linux native control was run in the profile review,
and the strict Apple mismatch and original expectations remain unchanged.

This addendum only records existing acceptance; no accounting test or source
was rerun/changed here. The new old9 baseline remains underway separately, with
no current count asserted; the five custom-first-read cases remain separate.
No full-scope, full Bash, overall kernel parity or superiority claim follows.
