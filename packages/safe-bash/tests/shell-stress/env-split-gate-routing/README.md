# Exact env-S broad-gate routing: no fixture migration

August 27, 2026. Read-only classification of the **exact 84**
`env-S-preimplementation` rows in
`tests/integration/full-gate-20260827/combined-b494675c/FAILURE_ROUTING.json`.
Only this new evidence directory is owned. No existing test, expected tuple,
source, package/configuration, oracle, private checkout or other owner's evidence
is changed.

**A=0, B=0, C=0, D=84, unknown=0. Proposed mutable paths: `[]`.**
The 84 are valid current canonical tests failing on a source that predates the
implementation, not 84 obsolete goldens. No live-fixture patch is required or
proposed. This proposal follows the actual committed independent core verdict;
it does not confer permission to edit fixtures or run a replacement broad gate.

## Exact population, not pooled scores

| Canonical partition | Original failures routed here | Entire unchanged file |
| --- | ---: | ---: |
| `tests/shell/env-split-native.test.ts`: exact native tuples | 59 | 59 |
| Same file: literal missing-target policy | 2 | 4 |
| Same file: actual TypeScript import/inventory assertion | 0 | 1 |
| `tests/shell/env-split-host.test.ts`: bounded host scenarios | 23 | 25 |
| **Total** | **84** | **89** |

All 84 routing entries have distinct IDs and names, `indent=0`, `type=test`, and
`failureType=testCodeFailure`. **Aggregate parent failures: zero.** Each of the
23 host test wrappers represents one scenario, not an extra wrapper plus its
child assertions. Multi-call host assertions are not inflated into new cases.
The separate author limit test containing ten internal controls is excluded:
it accounts for the author's 90th Node test, not ten more routed cases.

The five pre-existing passes are `literal-single-optional-argument`,
`preabort-no-dispatch`, the import/inventory assertion, and the two missing-target
policies `after-assignment-is-literal-command` and `no-S-single-target`.
They remain outside the 84. The two routed missing-target cases are
`empty-quoted-command` and `bare-dash-stops-options`.

Curie's complete original result remains **16,840 tests: 16,520 pass, 307 fail,
13 skip, UNQUALIFIED** because of missing native prerequisites and the artifact
writer defect. Nothing subtracts these 84 from that historical 307 or promotes
the invalidated capture. Missing native staging is not an env product bug.

## Source identity and unchanged canonical expectations

| Role | Full committed identity |
| --- | --- |
| Author 89-test preparation | `db3680fcfa91a7fff6ca0dad332c297094d14783` |
| Author original red source | `e7f4f2e3753184415f8098445c2009cb4cd9a6e9` |
| Broad-gate product | `b494675c34dc289f4ad4b10a9201e1211eb0a7d8` |
| Broad-gate evidence/routing | `954406871fae381b1c69441b34946a224201d7ad` |
| Implemented product | `84ab66ca717e0dff21abf57051b41cb553f3c7f3` |
| Author core evidence seal | `a84dd195c13935587df0d53be85c86790a48e4d5` |
| Selected current canonical inputs | `1a18cb1858f9453f41a20caff0988c578aa9c7e2` |
| Independent v2 input freeze | `fbd4a2c4c8c8215bbc04a1ab923af47e1bd64d22` |
| Actual independent sealed verdict | `8ab677479e0094ec0c6cdf90d1f0e87883b2f8dc` |

The two canonical tests, `resume-host.ts`, `resume-fixtures.ts`,
`resume-cases.json`, `native-frozen.json`, and `resume-native.json` are byte-equal
across preparation, broad source, implemented source, selected current inputs,
and the independent verdict commit. `summary.json` retains every Git blob and
SHA256, the exact source differences, and the full source-tree identities. This
seven-input authentication is not a claim to have checked all repository
TypeScript fixtures or all current dirty work.

From b494 to 84ab the entire `src` diff is only new
`src/commands/env-split.ts` plus the env changes in `src/commands/execution.ts`.
The latter previously accepted `iu:0C:` but not S. It now delegates to the bounded
split parser; the delta also corrects lone-dash option termination and checks
the null/command conflict before cwd lookup. Runtime and command contracts are
unchanged. All `src` bytes at the selected current-input and independent-verdict
commits equal 84ab; their tree is
`f214264ae13d47e1369513a12ccd2d6cf944a6ef`.

Key SHA256 identities, also repeated on every classified row:

- Old execution: `1d084ab203dc59a510e39e5c71743b755ba9bdb5d4b018658398ed96c3dff700`.
- Current execution: `61940d3b86593243c13cab716be87f84647e42b69476757482dfebafc7d693a6`.
- Current parser: `b005331bff0dd207a65b9001d235020f005eed45b813cca912851502c3f9dcf4`.
- Unchanged runtime: `2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b`.

The e7 original author red capture is not silently equated with b494: six other
source files differ between those commits. Their env execution/runtime bytes
match, and every routed exact-tuple failure's actual tuple independently matches
the original TAP. That comparison does not invent unrecorded broad-gate host
observations.

## Actual evidence for D, not score guessing

The author's unchanged 89 tests pass within the sealed 90-test author run; all
84 names are checked individually against its raw output. Its later concurrent
`network/body.ts` and `structured/jq.ts` differences remain disclosed. Therefore
this classification also performed one bounded replay against **all committed
84ab source** and the seven unchanged selected-current inputs, rather than
assuming the author's earlier in-flight tree was identical to final 84ab.

`canonical-replay.json` records **89/89 pass, zero failure/skip/TODO/cancellation**,
August 27 **12:02:06.169–12:02:11.942 UTC**, Node 22.22.2. It authenticates 213
source files plus two root inputs and seven canonical fixture inputs against Git,
before and after. Existing local development tooling is borrowed without an
install. The import assertion resolves actual scratch TypeScript product files.
No native oracle is launched. All 25 host children satisfy the original PID-reaped
assertion; no surviving host command is found, and scratch is removed. This is a
bounded classification replay, **not** a new independent core acceptance.

The actual independent verdict is now committed in
`tests/shell-stress/env-split-validity-review/V2_REVIEW.md` at **8ab67747**, with
`post-v2-audit.json` and the untouched `acceptance-v2-1.json`. It accepts **bounded
core integration on exact84ab with disclosed valid v2 fixtures**, not native
diagnostic parity, shebang support, unchanged invalid original assertions, or a
broad gate. The raw acceptance SHA256 is
`c3d8d510ccddfd0457b506e0741507000b1fe4bdb49f80c5edebe955667ce81d`.
Its actual source, freeze, artifact hashes and distinct reviewer/author thread
identities are authenticated in `summary.json`; no assumed seal is consumed.

That review runs 191 product children plus four tooling children, with all six
independent groups and 14 variants passing. Revised hidden hosts pass 7/7 and
packed hosts 5/5 executions in three IDs. These **different cohorts are not a
name-for-name replay of the canonical 89**. Their whole primary hidden native
cohort remains 40/48 (commands 39/42; protocol 1/6); the historical Apple profile
remains 23/48; packed whole native cohorts remain 7/10 each. All original losses,
invalid-fixture failures, the v1 refusal, and protocol limits remain intact.

## Grammar, diagnostic and protocol distinctions

The 59 exact native expectations comprise **48 status0 tuples and 11 status125
invalid-grammar tuples**, not 59 success-only witnesses. Their broad actuals are
all usage2: 57 report `env: invalid option -- 'S'`, one rejects
`--split-string=rec one`, and one rejects `--split-string`. Current grammar125
errors are supported invalid-input behavior, not obsolete error goldens.

The original 41 expectations use fixed GNU env9.7 directly on Darwin25.4/arm64;
the supplemental 18 use that same env through fixed GNU Bash5.3. Complete
original Apple/supplemental Bash3.2 references are retained, not switched per case.
The exact tool hashes, whole profile, environment, cwd, argv and recorder hash
are retained in `summary.json` and each row's native reference. GNU-on-Darwin is
not labeled GNU/Linux. Native availability was not required for this JSON-backed
canonical replay and was not re-probed or repaired.

The two routed status127 policies deliberately require nonempty **virtual registry**
diagnostics, not GNU env host-exec stderr equality. All four original raw127
diagnostic nonmatches stay in the author's 59/63 raw result. They are not grammar
failures and do not become native passes. Registry commands are not relabeled
as builtins. The independent review's three strict dispatch diagnostic losses
are similarly retained.

Host expectations remain valid for literal dispatch, exact exported maps,
parent/local/cwd state, binary bytes and stdin origin, shared budgets, finite
split caps, cancellation and cleanup. The old shared-output test fails when the
**unsupported-option diagnostic itself** overflows its four-byte positive bound;
it does not establish a remaining child-output accounting bug. Other hosts
often fail because their intended child never enters. Each precise failure stage,
host branch, assertion diagnostic and command expression is preserved per row.

No routed row tests a newly successful env-S shebang. The unchanged non-S
single-optional shebang refusal is one of the five original passes. Independent
five hidden primary and three packed protocol losses remain losses, outside
this 84; supported parser evidence does not complete runtime shebang routing.

## A/B/C/D decision and exact proposal

- **A0:** no existing expectation needs changing for supported core env-S.
- **B0:** none of these 84 live rows is an old-product characterization pin.
  Historical **artifacts** are nevertheless immutable: reproduce b494/e7 product
  observations only with their frozen source, and retain complete native profiles.
  Referencing immutable native expectations does not turn a live test into an
  old-product replay test.
- **C0:** no remaining product bug is established by these exact 84 on the bound
  source/test combination. This is not a claim about unrelated rows or features.
- **D84:** all current expectations remain valid and pass unchanged.

**Migration proposal: zero files, zero assertions, zero tuple updates.** Keep the
two canonical tests and all five imported fixture/helper inputs unchanged. Do not
rewrite original preimplementation failures, raw tuples, routing, prior refusal,
or native captures. ROOT can decide a separately authenticated later gate; these
scoped results do not certify that gate or any future moving HEAD.

The 89 diagnostic-driver pins, ten cleanup pins, foreign 30/11 type errors,
native prerequisite repairs and runtime feature expansion are expressly outside
this assignment. No migration patch for them is included.

## Files and bounded verification

`rows.json` has exactly one compact object per routing ID, with test path/name,
real source line and SHA256, original transpiled TAP location, product hashes,
literal argv or complete host branch, whole-profile reference, expected/actual,
failure stage and D disposition. Raw diagnostics not duplicated in a row are
bound to the immutable original routing field by SHA256 and exact TAP line.
`summary.json` contains the crosswalk, partitions, input hashes, source diffs,
sealed independent verdict and zero-path proposal. All native byte tuples stay
hex-encoded without normalization; unavailable inner host tuples are not invented.

Run `node tests/shell-stress/env-split-gate-routing/classify.mjs` for read-only
regeneration comparison and all crosswalk/hash assertions. It performs no
product/native execution when published outputs exist. `replay.mjs` documents
the one completed bounded execution and refuses to overwrite its capture; do not
delete that capture to rerun it. There is no broad-gate rerun, oracle switch,
rebaseline, dependency/private change, or claim of native parity or superiority.
