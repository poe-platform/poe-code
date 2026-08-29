# Independent G01 validation on the approved NUM prerequisite

## Verdict and ownership

August 29, 2026. Noether, delegated independent validator. **READY for the exact
G01 candidate on the separately pinned NUM001 prerequisite**, not a release or
future integrated-main approval. No production changes, author assertion edits,
Git mutations, README edits, other-clone writes, or original-audit reads occurred.

Workspace: `/Users/kjopek/Workspace/poe-code-safejs-value-bookkeeping-integrated`.
Actual base: `87f65dc26cdbdf28500e836204d2b205caaf8b80`.
Author integration manifest:
`out/safejs-remediation/g01-integration/manifest.json`, SHA256
`2efd257adfd1aab2139c9572ba5c4e3e42e6b37584bdc52066e49e886bfd2ccb`.
All 65 listed capture files were independently byte/hash verified. The 11 NUM
postimages, seven genuine-base preimages, three G01 postimages, and 34 protected
upstream paths were checked against their applicable source state. Author
production and tests remain frozen. This validator adds only this report and
`packages/safejs/src/interp/values-bookkeeping-validation.test.ts`.

Candidate directory:
`out/safejs-remediation/g01-integrated-validation/candidate-20260829-87f65dc-noether/`.
Its `manifest.json` records exact relative paths, byte counts, SHA256 values,
absent-path preconditions, separately pinned NUM files, post-NUM preimage, and
verified immutable copies. The manifest hash is supplied in the handoff, avoiding
a circular self-hash in this captured report.

## Ordered source states

| State                          | `values.ts` SHA256                                                 |
| ------------------------------ | ------------------------------------------------------------------ |
| Genuine main base              | `487d392c295977bdd144713382e5ab142d85a3dfac27a8fe9cfea8c669dbbf75` |
| Approved NUM prerequisite only | `1e027e9c9c100b0849b7b8e4ab02b747181f63ce1383e9e467fecc37e76ad4a6` |
| NUM plus G01 candidate         | `a453757823a826a5c533a5b13e44cdb2021783889e90601608bac932f5f3db86` |

The NUM layer manifest is SHA256
`b79876b62abacd2cad67db5b5f464673433061131924682c76f6be5d7ec6cddf`.
The incoming G01 layer manifest is SHA256
`be13ea9d8fc3eec3f73da43ffb68751daebbaacc33fdda4dc007827ebe8daa4a`.
G01 changes exactly two measurement hunks relative to NUM, not NUM's function
arity logic. Removing `measureSandboxData` from both texts leaves byte-identical
source. Every other NUM postimage matches the approved captured file exactly.
All seven current-main preimages match `git show <base>:<path>`; new paths are
absent from that base. Nothing was applied to another checkout.

Publisher intake must establish the complete NUM prerequisite first, then require
the exact post-NUM `values.ts` preimage before applying G01. The G01 payload has
five publishables: author production/test/plan plus validator test/report. The
NUM eleven are a separate prerequisite, not eleven extra G01 changes.

## Functional contract review

`packages/safejs/src/interp/values.ts:386` measures retained values. Measurement
is runtime bookkeeping, not a source property read: it must not execute ordinary
own getters or change observable state. The two changes use own descriptors for
array indices and enumerable object fields. Stored data values are traversed;
accessors retain slot/key charges without evaluating a return value. Array
length, holes, nonenumerable stored indices, shared references and cycles retain
their accounting. Ordinary nonenumerable object fields remain unmeasured.

This is a legitimate internal functional invariant, not a claim that arbitrary
accessors are supported public inputs. The internal structural type does not
itself enforce descriptor restrictions. Trusted branded runtime values keep
their existing distinct branches and contracts. The change does not promise
general accessor, exotic-object, or host-getter parity. No such probes were added.
Array named metadata accounting and serialization are not expanded.

Source dispatch and the descriptor-based public copying guards are unchanged.
The existing ARRAY receiver/key/callee-before-argument behavior remains intact;
nullish optional calls skip arguments. For ordinary object inputs, public copy,
raw run binding and ordinary host-result conversion still refuse enumerable
accessors before invocation. Nonenumerable omission remains the existing author
control, not public accessor support. No guest getter grammar was introduced.

The independent 16 tests cover four repeated measurement/descriptor/state checks,
one stored-value graph check, eight original benign call witnesses and three
zero-read public refusals. Complete post-completion traces and getter totals are
asserted, not merely an early `trace.slice()` result. Native expectations execute
first with fresh fixtures. Tests perform no filesystem, network, process, or LLM
guest I/O; the host-result stub is a pure in-memory function.

## Genuine RED and independent GREEN

Both RED executions use a Vitest pre-transform of immutable captured source,
without modifying production files or Git. Genuine-main execution overrides all
five modified NUM production modules with their actual base preimages; four are
loaded by these tests, while snapshot restore is not imported. NUM-only overrides
only `values.ts` with the post-NUM preimage. The author 25 and independent 16
assertions are unchanged between states.

| Command receipt                        | Actual result                                                       |
| -------------------------------------- | ------------------------------------------------------------------- |
| `genuine-main-red.json`                | 12 failed / 29 passed: author 7/18, independent 5/11                |
| `num-only-red.json`                    | 12 failed / 29 passed: author 7/18, independent 5/11                |
| `combined-focused.json`                | 41 passed: author 25, independent 16                                |
| `focused-final.json`                   | 41 passed again after validator-only formatting                     |
| `independent-num-green.json`           | 96 passed / 26 filtered, four files                                 |
| `independent-array-coll.json`          | 177 passed: ARRAY 26+15 and COLL 136, five files                    |
| `broader-functional.json`              | 1,761 passed / 94 filtered, 43 files; selected, not full suite      |
| `independent-values-controls.json`     | 19 passed / 21 filtered, two collected files                        |
| `independent-checkpoint-controls.json` | 5 passed / 26 filtered                                              |
| `full-build.json`                      | 67 successful tasks, zero cached; root schemas/types/bundle succeed |
| `independent-safejs-source-types.json` | Exit 0, no diagnostics                                              |
| `four-new-test-types.json`             | Exit 0, no diagnostics in the strict four-new-test command          |
| `independent-configured-lint.json`     | Exit 0: ESLint, configured root types, workflows                    |
| `independent-package-lint.json`        | Exit 0: all 17 package rules                                        |

Receipts under candidate `evidence/independent/` retain complete argv, inline
inputs where applicable, stdout, stderr, timestamps and exit codes. Ordinary
focused invocation is `env -u TERM ./node_modules/.bin/vitest run` followed by
the two bookkeeping test paths and `--reporter=verbose` or `--reporter=json`.
The RED receipt's inline Vitest invocation records the exact preimage map and
reports which modules were transformed. There is no executable QA runner file.

The build command is `env -u TERM SKIP_SYNC_SKILLS=1 POE_SNAPSHOT_MODE=playback
POE_SNAPSHOT_MISS=error TURBO_FORCE=true npm run build`. Build completed before
the source, configured and supplemental type gates. The new-test command uses
`tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict
--esModuleInterop --skipLibCheck --noEmit` on the author bookkeeping test, both
new NUM tests and the independent bookkeeping test. All commands retain their
exact environment arguments in the receipts.

The broad selection is the frozen author functional file selection plus the
independent test, with the exact same name filter. All 94 filtered names match
the author's list, independently checked by file and full test name. It excludes
security/prototype, malformed-data and stress/budget cases as specified, and also
filters some functional names containing those words. Three cases passing in
NUM96 are absent from the broader conjunction: snapshot inherited AST fields,
snapshot inherited serialized kind tags and the closed-world unknown function
method control. `selection-audit.json` preserves every filtered name and the
exact commands; no filtered test is counted as passing or waived. No unrestricted
full-suite or whole historical workflow-fixture claim is made.

## Complete original witness outcomes

`evidence/independent/full-witness-outputs.json` retains all 24 full observations:
eight exact original guest source strings/native expectations/current outputs
for each of main, NUM-only and combined. The original source strings and
expectations were not adapted. Undefined is represented as
`{"$type":"undefined"}` in JSON. Direct replay of the author's two current Node
commands also passes and agrees byte-for-data with the canonical Vitest replay.

| Witness, each at enumerable true and false | Native and combined complete return value               | Combined total getter reads |
| ------------------------------------------ | ------------------------------------------------------- | --------------------------- |
| Array callable own getter                  | `[10,["receiver","key","get","argument","call"],100]`   | 1                           |
| Object callable own getter                 | `[10,["receiver","key","get","argument","call"],100]`   | 1                           |
| Array noncallable own getter               | `["TypeError",["receiver","key","get","argument"],100]` | 1                           |
| Object nullish optional getter             | `[undefined,["receiver","key","get"],7]`                | 1                           |

Both genuine-main and NUM-only reproduce the enumerable ordinary-object callable
failure: result `-1` instead of `10`, 32 getter reads instead of one. Both also
reproduce the enumerable optional witness: correct undefined result and skipped
argument, but 31 reads in the returned trace and **38 total** through completion.
The older 31-read observation was a trace snapshot, not the final total. Both
array controls and all nonenumerable controls match native on all three states.
All three public ordinary-object refusal controls observe zero getter reads in
RED and GREEN. No whole-fixture PASS is inferred from these bounded observations.

## Preserved failures and qualifications

The genuine RED logs remain intact. The author plan and captured receipts retain
the earlier construction failures (22/7 and 8/17), corrected valid 7/18 RED,
formatter/linter history, and build-asset prerequisite history. These are not
rewritten as successful first attempts. The older NUM expanded four-test strict
type command's 38 diagnostics remain historical and are not claimed repaired;
that different unconfigured command was not rerun. The strict command here checks
four new tests and has zero diagnostics.

The first independent full-output wrapper retained the original Node `.ts` import
spelling inside a transformed Vitest test. Its two combined collectors failed
with callable `TypeError`; its four baseline collectors completed but their
callable observations are invalid wrapper evidence. Using the package test's
canonical `.js` module imports fixed the wrapper; guest source and expectations
did not change. All six corrected collectors pass, reproduce the authentic
baseline counts, and match direct Node current replay. The initial six receipts
are retained with this explicit invalid-wrapper designation, not silently
discarded or attributed to a production defect. Observation-collector exit 0 on
a RED state means collection completed, not that its outputs matched native.

No original audit input was opened, hashed, executed or searched. Therefore no
38-path/security guard bootstrap was needed for this run: original input reads
0, excluded security payload reads/hashes/executions 0. The 65 verified captures
are this author's integration evidence, **not** excluded security archive bytes.
Any later original-input replay still requires the 38 exact exclusions plus the
entire security-directory guard before concrete allowed functional input reads.

Named-array checkpoint metadata/raw alias loss remains a separate OBJ002 issue
on this source state; the separately validated OBJ candidate is not merged here.
Regex own-key ordering and broader host-getter differences remain explicit
follow-ups. README permission remains pending: this validation adds no README
content and grants no permission for it. Future actual-main/AW/OBJ integration
requires fresh independent checks; this verdict does not certify it or any
current/future release. Generated terminal font assets are excluded from intake.

## Final intake checks

Final scoped Prettier checks cover all 15 unique current publishable paths:
NUM eleven plus G01 five with one shared `values.ts`. Only this validator's test
and report receive formatting edits. `final-publishables-format.json` and
`final-diff-check.json` record the actual final checks. The frozen author plan is
not reformatted. Captured files and preimages are verified after copying, then
made read-only and immutable; the seal verification checks hashes and flags.
Publisher must recheck every applicable preimage and absent path before intake,
and run fresh integrated gates after any other runtime merge.
