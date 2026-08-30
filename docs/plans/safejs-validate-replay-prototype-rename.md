# Independent renamed replay-prototype validation

Date: 2026-08-30. Reviewer: Noether, delegated independent validator.

## Verdict and identity

**SCOPED READY** for the frozen eight-file author candidate plus this report (nine publishables). No production repair was made by the validator. This is candidate approval, not a released npm or universal compatibility claim. Publisher must verify preimages and capture current normal full-gate parent exits.

- Pulled main/checkout: `0b10f2f4d4ccda5577b87ee72bdb85a2fa992558`.
- Author manifest: `/Users/kjopek/Workspace/poe-code-safe-js-replay-prototype-rename-integrated/out/safejs-remediation/replay-prototype-rename/candidate/manifest.json`.
- Author SHA-256: `efeb543b7f85e6dda2ed240a18f5022408153719bf8838d7987ba196ceb8cced`.
- All 224 explicitly listed author artifacts authenticated: 25,453,219 bytes. Unlisted artifacts and original audit chronology are not certified.
- Independent capsule: `out/safejs-remediation/prototype-rename-independent/candidate-0b10f2f4-ready/manifest.json` in this isolated clone.

The three existing preimages are values.ts, run.promise-compatibility.test.ts and input-error-projection.test.ts under packages/safe-js. The other six publication paths are absent at the pinned base. Exact paths, bytes, hashes and captured preimages/postimages are in the manifest. The production change remains the single allocation hunk. Upstream's three canonical O12 imports are preserved; no old package directory/private dependency alias was recreated.

## Fresh execution

Every argv, start/result, stdout/stderr and bound is retained under capsule evidence/commands. Exits alone are not functional verdicts.

| Gate                                   | Current observation                                                       |
| -------------------------------------- | ------------------------------------------------------------------------- |
| Owned installation                     | npm ci --no-audit --no-fund, exit 0                                       |
| Fresh build                            | TURBO_FORCE=true npm run build: 68 uncached tasks plus root build, exit 0 |
| Focus/context/FS                       | 199 passing tests in 12 files                                             |
| O12 source/built                       | 10 + 10 passing tests; 36 typed child observations                        |
| Canonical aliases/CLI/package metadata | 94 passing tests in four files                                            |
| Selected total                         | 313 passing tests; not the full root suite                                |
| Owned test types                       | Four entries, zero diagnostics                                            |
| Configured lint/types                  | npm run lint, exit 0                                                      |
| Bounded workflows                      | 49 commands: 47 exit 0; two literal Float exit 1 retained                 |
| Formatting                             | Exact publication files; no unrelated formatting repairs                  |

CPU release at 09:28:09Z has SHA-256 `8db0c9dcd8f4c6f0392c1015a4c326d9d8602af21f740a9136f637b22c7a8c5d`. Subsequent work was metadata/static only except root's single exact README probe below. That child (PID 57262) exited at 09:37:22.229Z; no owned workflow child remains.

The 1,243 metadata assertions are not additional runtime cases. Forty failed observer assertions remain recorded: six selected wrapper.replay instead of wrapper.snapshot.replay; two omitted the declared null-record onReplay notification; 32 demanded outcome-wrapper reference identity where cloning and the test require deep equality. Correct selectors/equality were checked against captured shape and source. Actual outputs were never changed. Schema-inspection, report-template parse and pack-output JSON-prefix parser errors remain disclosed; none reran target workflows.

## Whole-output adjudication

### O15

Unchanged seed 123/42 programs retain the shared UUID/LCG stream, all 54 random draws, clock 1006, full native anchors and original 12-second/256-MiB/16-MiB limits. Two fresh native outputs equal the retained complete native expectations. Four source/built producers and four fresh-process restores were reviewed in full.

Each current return graph has 23 nodes: 16 null-prototype guest records, three ordinary host acknowledgements and four arrays. Complete values, own data/descriptors, ordered references, random/error graphs and ten meaningful expected-domain anchors match. Fresh restores have zero new host calls, the complete 15-event native replay sequence, and the producer's entire completed snapshot/journal. Conversion is confined to the approved finalAttempts expected input-boundary observer. Original literal 9/10 remains RED; actual values and acknowledgement provenance are not normalized. Boundary copying is not misrepresented as direct original-host pointer identity.

### O12 and saved-v6 continuation

Current V6/prototype, source-function/context and O12 complete/minimal/raw-left/genuine-null controls pass in the mapped package. Historical v6 bytes and old lossy captures remain unchanged. Newly reissued ordinary host records retain ordinary provenance; historical null records are not grafted onto ordinary prototypes. Completed restores do not reissue effects.

All 36 O12 typed observations were decoded: sixteen pending restores, sixteen followups, two producer captures and two raw-Error negatives. Full expected values, request source/module/operation/digest/call IDs, callbacks, initial inputs, settlement prefixes and whole five-call journals were checked. Complete modeled reasons retain metadata, modeled Error identity and aliases. Minimal proof loses exactly the error-type marker and stack; native-fields remains separately qualified. Raw-left differs only at three originating ordinary host-record nodes; genuine-null/input-converted controls stay null. Keys, descriptors, array/event aliases and unchanged receipts are checked. Receipt recovery equals the whole producer capture with zero calls/requests; followups preserve whole journals and promise replay. Genuine raw Error refusal remains a negative control. Arbitrary cause-chain coverage is not established.

### Float and semantic replay

All fifteen camera observations match complete native values and 111/100/89-event traces, unchanged sources/fixtures and zero host calls. Seven typed observations preserve full node/edge graphs, shared buffers, caller bytes, callback observations and complete journal/initial-input identities; fresh restores make zero new calls.

Ten semantic controls retain String(await ack()) ordinary-host behavior, genuine-null records, declared replay notifications and zero fresh host reissues. Both old lossy captures still reject with the exact TypeError message/stack and zero calls; old lossy data is not repaired.

Seven raw Float controls include the two literal source/built REDs. API success is distinct from the caught guest return `{ ok: false, name: "RangeError" }`; that raw guest record has a null prototype. It is neither a host acknowledgement nor a caught Error object. A separate explicit guest-domain observation checks every key, descriptor and value, plus five negative comparisons. There is no blanket prototype projection.

## Local public pack and exact README proof

The independently built local `poe-code-0.0.0-dev.tgz` is 16,260,297 bytes, SHA-256 `589b63fcdd6e5b7ec646e89ba611aa8c64ca3d35144fb26bd751a19760717963`. It is not a registry release. It was extracted into owned temporary storage and used with a copy of this clone's independently installed locked dependencies, not another clone's mutable modules. This is not a clean registry-install test. Setup used owned HOME/cache/TMP and suppressed skill sync. Actual prepare/HUSKY output is retained; --ignore-scripts is not evidence that no hook ran.

Canonical/legacy public namespaces and export trees agree for main, core and CLI. Shared Budget/SafeFS identities are verified. Both actual packed binary aliases exit 0 with equivalent help; both screenshots were captured and visually inspected. Older portable adapters can use the supported public legacy alias, not the removed private package alias.

The initial three-probe receipt proved only **two of the three exact requested README snippets**: its locale probe reversed operands and used undefined locale. It remains unchanged. Root authorized exactly one additional small Node process against the same canonical public pack:

`return "10".localeCompare("2", "en", { numeric: true }) > 0;`

It returned API ok true, value true, exit 0, no signal/timeout. Source bytes/hash, argv, artifact binding and timing are in evidence/commands/canonical-readme-locale-exact.\* and evidence/canonical-readme-proof-correction.json. With the unchanged Float32Array and String(TypeError) probes, this supplies the three exact requested examples. Root supplied the canonical locale text; the pinned checkout README has no localeCompare snippet. No already-published README claim is made.

## Own-data allocation boundary

At packages/safe-js/src/interp/values.ts:659 allocation preserves only ordinary/null provenance. The loop at line 666 calls defineOwnDataProperty; the helper at line 954 uses Object.defineProperty, not copy[key] assignment. Own data keys **proto**, constructor and prototype therefore do not invoke inherited setters. getEnumerableObjectEntries reads descriptors and rejects accessors; isPlainObject admits only same-realm Object.prototype/null. Arbitrary prototypes/native functions are not newly admitted, and owned source-function context mapping is unchanged.

Snapshot replay-data.ts:370 also defines own data descriptors after flag validation. Existing values.test.ts:134 checks own **proto** preservation and an unpolluted Object.prototype; it was inspected statically, not counted among selected tests. Fresh clone/context cases cover native-function/custom-prototype/accessor/toJSON negatives. This directly changed-boundary review is not a security campaign or blanket sandbox certification.

## Qualifications and intake

- Historical O15 literal RED, both current Float literal REDs, old lossy negatives, prep/invocation failures and superseded empty-index evidence remain retained.
- Earlier author output reported 8,932/39 SafeJS and 26,559/41 root, but the parent exit was unreaped after a tool reset. Current scoped checks do not repair that missing exit. Publisher must capture normal current build/API/root exits.
- Earlier independent 219-test/49-workflow results remain historical, not renamed-current evidence. Current fresh totals are 313 selected tests and 49 bounded commands.
- No original audit/excluded security payload was read, hashed or executed. Historical guard/chronology qualifications are not retroactively certified.
- No source fix, README/SKILL/master-ledger edit, home sync, branch, commit or push. Generated files, dependencies, raw outputs and screenshots are not publication paths.
- Nine-file intake requires root approval and unchanged preimages. Later composition and actual released-package checks remain separate from this local candidate.
