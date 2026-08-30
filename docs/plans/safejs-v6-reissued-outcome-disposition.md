# Independent V6 reissued-outcome disposition

## Decision

**DISPOSITION READY: correct stale expectations for NEW host outcomes; do not add a V6 lossy-clone preservation mode.** The integrated candidate remains **NOT READY** until Nash applies the bounded test correction, the three preserved failures turn green without weakening coverage, and the independent integrated delta review completes. This is not a waiver or source-fix approval by itself.

Reviewed on August 30, 2026, against Nash manifest SHA256 `78bcc02d8b8c58280f4d80a6ec586aa7a73f7bffbb9ed6d143da79d5c99915b6`, base `dd7f0fcd0d7796ee17577af2a7d76da295cc5a70`. Integrated values.ts postimage is `539918a0e83b187784c0aa2b5773610b4e82928517c4fa2bd87d4feed2e296af`. This review performs zero SafeJS executions, builds or unit runs; it independently inspects authenticated captured outputs and unchanged public-contract/source evidence. Source, tests and fixtures remain unedited.

## Why these three expectations are stale

The failures are at `packages/safejs/src/run.promise-compatibility.test.ts:40` for data/saved, guest/saved and host/saved. Each saved fixture has a running, re-issue-policy boundary call with **no recorded outcome**. The test invokes a new host function returning the ordinary native object literal `{ boundary: label }`. Its newly obtained result is not historical fixture data.

The test currently compares that new outcome to the separate historical completed fixture, whose old writer already lost the ordinary prototype and encoded null. The sole mismatch per saved case is:

| Case        | Exact canonical replay pointer              | Historical completed expectation | Current new outcome |
| ----------- | ------------------------------------------- | -------------------------------- | ------------------- |
| data/saved  | /calls/0/outcome/data/nodes/0/nullPrototype | true                             | false               |
| guest/saved | /calls/0/outcome/data/nodes/0/nullPrototype | true                             | false               |
| host/saved  | /calls/1/outcome/data/nodes/0/nullPrototype | true                             | false               |

The saved inputs contain no value at those pending-outcome pointers to preserve. By contrast, host/saved contains a consumed readValue call at /calls/0; its entire recorded outcome and null prototype remain exact. All three completed fixtures preserve their complete historical journals unchanged. This is a mixed historical-prefix/new-suffix distinction, not global normalization.

## Authoritative contract and independent expected value

The following evidence is unchanged from pinned base dd7f0fcd, rather than newly written to justify this repair:

- `packages/safejs/CHECKPOINT_REPLAY.md:3`: completed operations reuse recorded results; still-pending operations follow their declared re-issue/reconciliation policy.
- `packages/safejs/CHECKPOINT_REPLAY.md:154`: onReplay receives recorded completed outcomes and does not run for pending reissued operations.
- `packages/safejs/CHECKPOINT_REPLAY.md:310`: genuine jobs-v6 stays v6 on later dumps; acceptance is not migration or a promise that every old failing history works.
- `packages/safejs/src/run.ts:200`: the selected V6 semantics and initial-input promise-conversion behavior are retained.
- `packages/safejs/src/snapshot/replay-data.ts:146` and line165: the existing canonical codec records the actual accepted ordinary/null prototype, own data descriptors and reference graph. A native ordinary record independently requires nullPrototype:false; a genuine null record requires true.
- `packages/safejs/src/interp/host-call.ts:489` and line515: existing encoded outcomes are decoded/re-emitted from their saved data; newly settled outcomes are encoded from the current result. `packages/safejs/src/snapshot/dump-format.ts:1` keeps dump version1.

No cited contract requires reintroducing the old prototype-loss bug when a pending V6 operation executes anew. A V6-specific lossy clone would again destroy the supported String coercion behavior already demonstrated independently. Preserve V6 scheduling/conversion semantics and historical encoded bytes, not a bug in data that did not yet exist.

I manually constructed the expected new canonical data from the test's native literal and the unchanged codec schema: root ref0; one extensible ordinary object node; a single boundary data property with value before and enumerable/configurable/writable all true. I did not call the modified clone helper or current encoder to manufacture its own oracle. Combining that explicit new outcome with the untouched historical completed row metadata yields **exact whole-journal equality for all six saved/completed cases**, not just equality after dropping the prototype field.

The packaged fixture has 81,409 bytes, SHA256 `c2b3bf03855bcb99f91e1182632edaa91965036254a4305c993a4c4aa0b30a6e`, and matches its pinned Git-base bytes exactly. The authenticated diagnostic asserts each input's serialized data unchanged. Its captured initialInputs and promiseReplay are unchanged for all six cases. Twelve subsequent restores preserve full canonical journals, initial-input graphs, promise metadata, dump version1, jobs-v6, return value7 and zero host calls. These are author-executed observations independently checked as data, not newly executed independent runtime passes. Full encoded reference edges are compared; these simple fixture results do not provide universal alias coverage.

## Exact author change request

1. Change only the expected-journal construction in `packages/safejs/src/run.promise-compatibility.test.ts` and append the author report. Leave `packages/safejs/test/fixtures/public-promise-v6.json` byte-for-byte unchanged; do not change source text, markers, captured outcomes or run/call IDs.
2. Retain exact completed-case comparison to fixture.completed.replay. For saved cases, identify the precise pending boundary call by its saved ID, require running/re-issue/no-outcome preconditions, and construct its complete expected newly fulfilled ordinary-record outcome from the fixed host literal/schema. Preserve every other row and field. Do not blanket-map all nullPrototype flags or feed actual snapshots through a normalizer.
3. Compare the **entire** expected canonical journal with exact equality, plus unchanged initialInputs and promiseReplay, jobs-v6, version1, complete return value, raw input bytes and exact host/provider call counts. Keep two no-effect subsequent restores and assert their complete journals equal the newly captured mixed journal. In host/saved, explicitly assert the old consumed readValue prefix stays null and is never reissued.
4. Capture the new stub's raw returned record and assert its native ordinary prototype independently. Add a bounded genuine-null boundary variant using the same unchanged saved inputs: only that new outcome is null; no graft is permitted. Completed inputs must still invoke no replacement boundary regardless of replacement stub shape.
5. Preserve old-lossy String capture negatives and the existing migration, source-mismatch, error and unsupported-marker checks. Current source/built old-loss negatives must remain TypeError with zero host reissues. Do not call them successful repaired old histories.
6. Strengthen the expected-journal predicate against changed values, missing/extra keys, changed references, wrong prototype, wrong call ID and outcome channel. Metadata checks here reject eight such mutations, including grafting the old readValue prefix. These are comparator checks, not eight new SafeJS runtime cases. Keep alias/reference assertions in the existing mixed-graph and Map tests; do not remove them to make V6 green.

**No additional production change is justified by these three failures.** If the strengthened tests expose another difference, retain it and route that concrete finding rather than extending this disposition.

## Counts and remaining gates

The exact captured source selection is `node_modules/.bin/vitest run packages/safejs/src`, exit1: **8,615 passed, three failed, 34 skipped; 204 passed files, one failed, one skipped**. This is the selected SafeJS src suite, not the complete repository suite or packages/safejs/test coverage. The compatibility file itself has 11 passes and three failures. Its failures occur before its later-repeat assertions in the three saved branches; the separate authenticated diagnostic supplies the later-repeat observations and does not erase the original REDs.

Author-reported integration results include ten O15, fifteen Float camera and seven typed-graph observations, 68 fresh build tasks and configured type/lint gates. This bounded review does not re-execute or grant blanket independent approval for them. The semantic evidence explicitly separates four initially historical-good fresh controls from four later current-capture controls; old-loss negatives remain separate. The additional actual Float raw-prototype failure identified as f8a221... remains open for targeted exact-capture validation; camera/typed-graph counts alone do not close it.

After root routes this disposition, Nash should freeze the test/report delta without changing the production hunk, rerun the exact failed source selection and bounded strengthened compatibility controls, and provide updated hashes. Independent review must verify assertion preservation and the new results. Recheck current values.ts preimages after the in-flight Map work rather than merging it here. Publisher gates and later actual-release verification remain separate.

## Boundaries

No original audit payload, excluded security file, home/skill/README/master-ledger write, source/test modification, Git mutation, guest IO or LLM call occurs. This report and its ignored evidence capsule are the only new authored material. Metadata comparison uses parsed JSON data and separately pins every recorded prototype flag; no raw guest values are normalized. The initial REPL structuredClone comparison was realm-sensitive and was replaced by a same-JSON-domain copy for metadata equality; actuals and input bytes were not altered. All three source-suite failures remain retained pending author correction.
