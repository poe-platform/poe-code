# G01: side-effect-free value bookkeeping

## Scope and invariant

August 29, 2026. Isolated author clone: `/Users/kjopek/Workspace/poe-code-safejs-value-bookkeeping`.
Base after successful `git -c pull.rebase=false pull --ff-only`:
`87f65dc26cdbdf28500e836204d2b205caaf8b80`.

G01 is bounded functional bookkeeping work, not a security investigation or a
general accessor compatibility project. Internal retained-value measurement must
not invoke ordinary input getters. It measures stored own data-property values;
an accessor contributes its existing structural slot/key cost, not an eagerly
computed return value. A source-level property read still resolves the property
once, in receiver/key/callee/argument order. Nullish optional calls still skip
arguments. Internal branded values retain their existing trusted runtime contract.

`SandboxValue` is a structural internal type, not a public accessor permission.
For ordinary object inputs, public copying, raw run bindings and ordinary
host-result conversion continue to reject enumerable accessors before invocation
and omit nonenumerable host fields.
No guest getter syntax, new host capability, guard removal or general accessor
parity is included. Array named-metadata accounting and checkpoint serialization
are not broadened by this change.

## TDD and verification

The independent remaining-dispositions report and hash-verified ARRAY captured
finite getter controls establish the witness. New pure tests independently check
native expectations before low-level interpretation, plus zero-read public
refusals. The same finite counter getter also checks direct object measurement
and array-index measurement. Existing ARRAY, generic call-order and COLL tests
remain unchanged. RED/GREEN commands and full outputs will be captured under
ignored `out/safejs-remediation/g01/`.

No original audit payloads, excluded files or security directory are read. No
other clone or ARRAY capture is modified. No README, commits, pushes, branches,
guest I/O, real LLM calls, or executable QA files are part of this task.

## Qualifications

This candidate needs a separate independent validator before publication.
Named-array checkpoint metadata/raw alias loss belongs to OBJ002; regex key-order
and broader host-getter compatibility observations retain their dedicated scope.
No whole historical workflow fixture is declared passing by this bounded fix.

## Actual implementation and TDD receipts

The only production change is two hunks inside `measureSandboxData` in
`packages/safejs/src/interp/values.ts`: array slots are visited through own data
descriptors; enumerable object descriptors supply stored values without invoking
accessors. Existing object slot/key charges and array length charges remain.
Nonenumerable object fields remain excluded; nonenumerable array data slots still
contribute their stored values. Holes, shared objects and cycles retain their
previous accounting. Branded collections, closures, arguments, promises and
regex branches are untouched. The interpreter, source property access, public
guards and serializer are not edited.

All receipts below are JSON files in `out/safejs-remediation/g01/evidence/`, with
exact command arguments, exit codes and complete stdout/stderr. Commands use
`env -u TERM`. No original audit payload was needed.

| Gate                                            | Actual result                                    | Receipt                       |
| ----------------------------------------------- | ------------------------------------------------ | ----------------------------- |
| Valid untouched-source RED                      | 7 failed, 18 passed                              | `focused-red-valid.json`      |
| Final focused GREEN                             | 25 passed                                        | `focused-final.json`          |
| Unchanged ARRAY metadata + generic calls + COLL | 177 passed: 26 + 15 + 136                        | `array-coll-regressions.json` |
| Selected broader functional regressions         | 1,468 passed, 34 filtered, 28 files              | `broad-functional.json`       |
| Existing value-copy/accounting controls         | 19 passed, 21 filtered                           | `values-functional.json`      |
| Existing benign await checkpoint controls       | 5 passed, 26 filtered                            | `checkpoint-controls.json`    |
| SafeJS configured source types                  | exit 0                                           | `safejs-types.json`           |
| Strict standalone new-test types                | exit 0                                           | `new-test-types-final.json`   |
| Root configured lint: ESLint, types, workflows  | exit 0                                           | `configured-lint-final.json`  |
| Package lint                                    | all 17 rules pass across 68 packages             | `lint-packages-final.json`    |
| All three publishable files formatted           | exit 0                                           | final format receipt          |
| Full root build                                 | 67 tasks pass, schemas/root types/bundle succeed | `full-build.json`             |

Broader coverage includes ARRAY, generic reference/call/promise order, interpreter
callbacks, method suites, COLL001, OBJ001, MC001, MC003, STR03, TREE01, HI002 and
keyword/computed methods present on this base. The explicit file list and
multiline-safe name filter are in the receipt. Security/prototype and
stress/budget cases are filtered, not counted as passing. This is not a full-suite
or whole historical fixture certification. Unit filesystem coverage uses memfs.

The new test consists of five measurement controls, sixteen internal call-order
controls (object/array, enumerable/nonenumerable, callable/noncallable/optional),
three public object zero-read refusals and one nonenumerable omission control.
Native expectations are asserted independently before interpretation. All prior
test files and validator assertions/history are unchanged.

### Complete finite witness outputs

`full-controls-red-enumerable.json` and
`full-controls-red-nonenumerable.json` retain complete native/current results,
source strings and read counts, including mismatches without stopping at the
first one. Their exit 0 means observation collection completed, not that the
enumerable baseline passed. Corresponding `full-controls-green-*.json` also
assert native equality for every case before reporting success.

| Witness                        | Native and candidate output                                       | Untouched base                                                                                  |
| ------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Array callable own getter      | `[10,["receiver","key","get","argument","call"],100]`, one read   | same                                                                                            |
| Object callable own getter     | `[10,["receiver","key","get","argument","call"],100]`, one read   | enumerable: `-1`, 32 reads; nonenumerable matches                                               |
| Array noncallable own getter   | `["TypeError",["receiver","key","get","argument"],100]`, one read | same                                                                                            |
| Object nullish optional getter | `[undefined,["receiver","key","get"],7]`, one read, no argument   | enumerable: 31 reads in returned trace, 38 total after final bookkeeping; nonenumerable matches |

The snapshot of the optional trace explains the older disposition report's 31:
the fresh receipt separately counts later reconciliation reads through completion.
JSON represents undefined as `{"$type":"undefined"}`. All eight full controls
(four cases at each enumerability) match after the patch. Public object refusals
keep zero getter reads, rather than enabling public accessor execution.

### Preserved author failure history

- `focused-red.json`: first test construction yielded 22 failed / 7 passed.
  The wrong parser import prevented sixteen call-order cases from running, and
  invented array-named-property public-refusal expectations were not supported by
  these existing paths. Those were corrected before the valid RED, without any
  production edit or existing-test mutation.
- `focused-red-corrected.json`: 8 failed / 17 passed; the host-result refusal is a
  rejected TypeError, not a resolved `ok:false`. Correcting that fixture left the
  seven real measurement failures, with all three zero-read object refusals green.
- The initial array named-accessor comparison showed `deepCopyToSandbox` refuses
  it, while raw binding/ordinary host-result array paths omit named metadata.
  This remains a separate metadata/copy follow-up; it is not generalized into a
  universal public refusal claim or fixed here.
- The initial formatter check and ESLint found formatting and a sparse literal
  in the new test. Formatting was applied via `apply_patch`; an actual array hole
  is now created through length/index assignment, with the accounting assertion
  strengthened to include both a hole and a nonenumerable stored slot.
- Package lint initially reported seven missing runtime assets before the full
  build. The full build supplies them; the final package lint passes without
  unrelated source changes. Four generated terminal font files are nonpublishable
  build artifacts, not part of the candidate.

## NUM001 publication dependency and overlap

The coordinator directs NUM001 to publish before future G01 integration. This
author baseline stays pinned; no NUM code is duplicated and no new pull changes
the TDD baseline. Approved readiness metadata was read only from
`/Users/kjopek/Workspace/poe-code-safejs-function-arity-integrated/out/safejs-remediation/num-001-integration-validation/readiness.json`.
It declares candidate manifest SHA-256
`d3e8d605c2a93ee2db22c16c6cc1acc66db373927aafbb23a25b7e7396fc234e`.

The exact shared production path is `packages/safejs/src/interp/values.ts`.
G01 touches only `measureSandboxData`; no NUM production file was loaded or
altered, so line-level conflict resolution is intentionally deferred. Path overlap
is not a claim that NUM causes or semantically requires G01. Later integration
must pull fresh main after NUM, preserve NUM's `values.ts` changes, apply only the
G01 delta with base/current preimages, and obtain fresh independent validation.
Never replace current `values.ts` with the captured whole author file.

## Candidate freeze and readiness

Status: author candidate ready for separate independent validation on its pinned
base; not a publication approval or an integrated NUM+G01 readiness claim.

Exactly three publishables are owned:

- `packages/safejs/src/interp/values.ts` (existing; one exact base preimage).
- `packages/safejs/src/interp/values-bookkeeping.test.ts` (new).
- `docs/plans/safejs-fix-g01-value-bookkeeping.md` (new).

`out/safejs-remediation/g01/manifest.json` records exact SHA-256 hashes, original
absence of the two new paths, source preimage, patch, command receipts, protected
prior-fix hashes, qualifications and the NUM-first handoff. Capture files are
read-only and locally ignored; source working files remain available to the
independent validator. No other clone, original audit or captured ARRAY input is
modified. There are no commits, pushes, branches, stashes or resets.

## Integration appendix: approved NUM001 followed by G01

August 29, 2026. The earlier author sections and their failure history above are
preserved byte-for-byte. This appendix records a separate integration-author run,
not independent validation or publication authorization.

### Isolation and ordered inputs

- New clone: `/Users/kjopek/Workspace/poe-code-safejs-value-bookkeeping-integrated`.
- Successful first pull: `git -c pull.rebase=false pull --ff-only`, already up to date.
- Actual main base: `87f65dc26cdbdf28500e836204d2b205caaf8b80`.
- Approved NUM manifest: `d3e8d605c2a93ee2db22c16c6cc1acc66db373927aafbb23a25b7e7396fc234e`.
- Frozen G01 author manifest: `f3cc1e43f6a32d81810151457cce646af7a4f48d71816afbb67218e3d36d632d`.
- Both input clones and captures stay read-only. No original audit payloads,
  original audit searches, commits, pushes, branch creation or other-clone writes.
- Dependencies use the pinned lockfile with `SKIP_SYNC_SKILLS=1 npm ci`.
  Commands unset TERM; the later runs also force snapshot playback/miss-as-error.

NUM is an explicitly separate approved eleven-file prerequisite. All seven
existing upstream NUM files match its captured base preimages exactly, so their
three-way merges are clean and their eleven layered postimages match the approved
hashes. No NUM assertion, validator report or failure history is changed.

G01 is still only the same three publishables: measurement source, the identical
25-assertion test file, and this owned plan with an append-only integration
section. Tests are staged early for TDD; that does not make G01 tests part of the
NUM prerequisite. The two G01 new paths are absent from upstream and from NUM.

### Minimal shared-file integration

The sole shared path is `packages/safejs/src/interp/values.ts`.

| Source state                        | SHA-256                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| Actual upstream / captured G01 base | `487d392c295977bdd144713382e5ab142d85a3dfac27a8fe9cfea8c669dbbf75` |
| Approved NUM-only G01 preimage      | `1e027e9c9c100b0849b7b8e4ab02b747181f63ce1383e9e467fecc37e76ad4a6` |
| NUM + G01 combined source           | `a453757823a826a5c533a5b13e44cdb2021783889e90601608bac932f5f3db86` |

`git merge-file -p` compares current NUM source, the captured G01 base and the
captured G01 postimage. Only the resulting current-to-merged diff is applied with
`apply_patch`: two measurement hunks, seven inserted lines and two deleted lines.
No old whole source file replaces NUM. Reverse-projecting only the G01 change
from the merged source reproduces NUM's exact approved postimage hash. This is
additional preservation evidence, not merely absence of conflict markers.

There are **zero textual conflicts and zero semantic repairs**. The G01 test
remains SHA-256 `09f45af6bcef2dbfcbb09aaf577f7d00fae0e43190535556543a2d963da5eb3c`
through every baseline and combined run. No production change beyond approved
NUM and the frozen G01 delta is introduced.

### Genuine baseline, prerequisite-only RED, combined GREEN

Complete commands, native expectations, outputs and failures are retained under
`out/safejs-remediation/g01-integration/evidence/`.

| State / gate                                   | Actual result                                   | Receipt                             |
| ---------------------------------------------- | ----------------------------------------------- | ----------------------------------- |
| Genuine current-main G01                       | 7 failed / 18 passed                            | `genuine-base-g01-red.json`         |
| Genuine current-main NUM                       | 49 failed / 47 passed / 26 filtered             | `genuine-base-num-red.json`         |
| Approved NUM only: G01                         | same 7 failed / 18 passed                       | `prerequisite-only-g01-red.json`    |
| Approved NUM only: NUM                         | 96 passed / 26 filtered                         | `prerequisite-only-num-green.json`  |
| Combined G01                                   | 25 passed                                       | `combined-g01-green.json`           |
| Combined NUM                                   | 96 passed / same 26 filtered                    | `combined-num-green.json`           |
| Combined ARRAY and COLL                        | 41 + 136 passed                                 | `combined-array-coll.json`          |
| Selected combined broader tests                | 1,745 passed / 94 filtered, 42 files            | `combined-broader-functional.json`  |
| Existing value/copy controls                   | 19 passed / 21 filtered                         | `combined-values-controls.json`     |
| Existing benign checkpoint controls            | 5 passed / 26 filtered                          | `combined-checkpoint-controls.json` |
| Three new tests, strict standalone types       | exit 0                                          | `combined-new-test-types.json`      |
| SafeJS configured source types                 | exit 0                                          | `combined-safejs-source-types.json` |
| Configured lint including root types/workflows | exit 0                                          | `combined-configured-lint.json`     |
| Package lint                                   | 17 rules pass across 68 packages                | `combined-package-lint.json`        |
| Full build                                     | 67 tasks plus generation/root types/bundle pass | `combined-full-build.json`          |

The broader selection is the union of the approved NUM and G01 functional file
lists with the conjunction of their exclusion patterns. No exclusion is weakened.
It includes 93 of the 96 NUM-focused passing cases; two inherited-field controls
and one closed-world-method control are filtered by the broader G01 selector.
All 96 pass in the separate unchanged focused selection. Exact omitted names and
all 94 broader filtered names are recorded in `suite-result-audit.json`.
Filtered cases are not reported as passing. These counts are overlapping gates,
not additive unique-test totals.

Full enumerable/nonenumerable witness receipts exist for all three source states:
`genuine-base-full-*.json`, `prerequisite-only-full-*.json` and
`combined-full-*.json`. Native expectations are independently asserted first.
In both baseline states the enumerable callable object produces -1 and 32 reads;
the optional object has 31 reads in its returned trace and 38 by completion.
Combined results have exactly one read, callable output
`[10,["receiver","key","get","argument","call"],100]`, and optional output
`[undefined,["receiver","key","get"],7]` without argument evaluation.
Array callable/noncallable and all nonenumerable controls also match native.
All three public ordinary-object refusal paths retain zero getter reads in every
source state. Observation-only RED witness commands exit zero when collection
completes; that is not a semantic pass. Combined witness commands assert equality.

### Freeze and independent-validator handoff

The ordered capture is `out/safejs-remediation/g01-integration/manifest.json`.
It references a separate NUM prerequisite manifest/patch with eleven files and
seven actual-upstream preimages, followed by a G01 manifest/patch with exactly
three files and the one post-NUM source preimage. The two G01 new files have
explicit absence records. The layers contain thirteen unique working paths;
`values.ts` intentionally has different prerequisite and combined postimages.
All file hashes, source-state checks, command receipts and patch applicability
checks are retained. Captured files are ignored and read-only; four generated
terminal fonts remain excluded build artifacts.

Readiness is **integration-author ready for a new independent validator**, not
publication approval. The validator can check genuine main, NUM-only and combined
states from exact captured preimages without altering either frozen input clone.
No whole historical fixture or unrestricted suite PASS is claimed.

The original NUM report's expanded four-file strict-test-typing failure history
(38 existing diagnostics) is preserved; this integration does not claim that
unconfigured gate was repaired or rerun. The configured source/root types and
three new-test types above pass. Other published upstream fixes, including the
keyword/computed-method parser tests, remain in the current-base broader coverage.
Named-array checkpoint metadata/raw alias loss belongs to the separate OBJ002
lane. Regex key order and wider host-getter compatibility retain their dedicated
follow-ups. No general accessor parity, guest getter grammar, public guard change,
security research or original-audit payload replay is added.
