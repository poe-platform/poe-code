# Independent OBJ002 validation

Date: 2026-08-29. Delegated validator: Noether. Author: Boyle (frozen).

## Scope and freeze

Validate only sparse-array checkpoint representation and the exact previously observed
named-array `metadata`/`raw` graph loss. This is separate from ARRAYOWN accessor and
call-order repair. No production changes, Git mutations, other-clone writes, guest IO,
real LLM calls, or new security probes are authorized.

Base: `33c73a21fb01875b0e2297ccac955974a0889991`.
Author manifest: `out/safejs-remediation/obj-002/manifest.json`, SHA256
`3324e01bf3cc65b9f56659bb16bad28d0b89fd51db2ef6468345de6c163e5199`.
All eight author files, captured copies, and five Git base preimages were independently
verified before validation. Author evidence remains frozen and untouched.

## Original-input guard

Before original payload access, read only the known `inventory-verification.json`
metadata (SHA256 `2ff2b353edf16714ee705dd550903a11bae70e1d7a544357de81d540b13ff827`).
Restore all 38 exact exclusions plus the entire `security/` subtree. Explicit functional
allowlist only: `inventory.json`, `objects/reductions/structured-sparse.ajs`,
`checkpoint-composition/results.json`, `checkpoint-composition/03-codec-workflow.ajs`.
No recursive audit searches or excluded payload reads, hashes, or executions.
Use “allowed functional audit inputs,” not “archive bytes,” in final verification.

## Procedure

1. Inspect both serializer paths, reference indexing, allocation-before-recursion,
   own enumerable data-entry handling, and supported legacy array representations.
2. Add independent package-local graph tests; run the unchanged tests against genuine
   base production preimages via an in-memory Vitest transform, then current source.
3. Establish native expectations before unchanged sparse and codec original executions;
   capture and resume every codec boundary twice and verify completed snapshots.
4. Run focused and adjacent tests, full build before configured types, lint, scoped
   formatting, and the configured full test gate with `TERM` unset. Preserve failures.
5. Reverify frozen inputs and capture publishables plus preimages immutably if ready.

## Pending qualifications

Regex own-key ordering and ordinary-host-getter differences remain separate pending
follow-ups. ARRAYOWN accessor/call-order changes are not included or validated here.
STR03 replacement differences belong to their separate integration work. Descriptor
flags, non-enumerables, symbols, accessors, and old readers consuming new records are
not claimed. Later merged publisher changes require fresh independent validation.

## Results

Evidence root: `out/safejs-remediation/obj-002-validation/`.
No production or frozen author test/plan was changed. The validator adds only
`packages/safejs/src/snapshot/obj-002-validation.test.ts` and this report, plus evidence.

### Independent RED and GREEN

The final 17 validator tests produce **12 failed, 5 passed** against genuine base
production preimages and **17 passed** against current source. All five changed
production modules were observed through the in-memory Vitest preimage transform.
The base tree was not checked out, patched, or edited. Assertions are identical
between RED and GREEN. Combined with 19 frozen author tests: **36 passed**.

The initial independent run also produced 12 failed / 5 passed, followed by 36/36
GREEN. A supplemental strict test-type check then found 17 validator diagnostics and
15 author-test diagnostics. Validator-only node-ID and scope-lookup narrowing was
added, without changing assertions; the final RED and GREEN counts repeat exactly.
All initial records are retained. Author history is separate: initial author
15 failed / 4 passed included an object-prototype expectation correction; corrected
author RED was 14 failed / 5 passed, then 19 passed. These are not independent runs.

### Exact metadata/raw witness

The prior observation is preserved in `metadata-observation-history.json`, including
its original command, complete snapshot, expected/actual result, and SHA256
`fcde6a65e6ee75cd71b59c318d4c249caac192ae9354816930ba02773193a46e`.
It was an **additional unasserted observation**, not one of ARRAYOWN's five failing
call-order tests. It is now explicitly asserted in both serializer paths.

The unchanged witness command creates `metadata = {count: 5}`,
`rows = Object.assign([metadata], {metadata, raw: metadata})`,
`object = {metadata, raw: metadata}`, and scope roots `{rows, alias: rows, metadata, object}`.
It serializes, JSON-roundtrips, restores, and checks identities and enumerable keys.
Its historical field name `nativeExpected` means the input-graph preservation
expectation, not a native checkpoint API.

```json
{
  "expectedAndCurrent": {
    "arrayAlias": true,
    "indexAlias": true,
    "metadataAlias": true,
    "rawAlias": true,
    "ownMetadata": true,
    "keys": ["0", "metadata", "raw"],
    "objectMetadataAlias": true
  },
  "historicalAndFreshBase": {
    "arrayAlias": true,
    "indexAlias": true,
    "metadataAlias": false,
    "rawAlias": false,
    "ownMetadata": false,
    "keys": ["0"],
    "objectMetadataAlias": true
  }
}
```

The exact historical command is replayed in `exact-metadata-witness-base.json` and
`exact-metadata-witness-current.json`. Base failure does not excuse this functional
loss: it is independently reproduced and **fixed in this OBJ002 capture**. It is not
retroactively fixed in the separate frozen ARRAYOWN capture or any publisher merge.

### Original algorithms

Only two allowed functional audit payloads were read, copied unchanged, and reverified:

| Audit-relative source                          | Bytes | SHA256                                                             |
| ---------------------------------------------- | ----: | ------------------------------------------------------------------ |
| `objects/reductions/structured-sparse.ajs`     |   261 | `e873c44afa16870b1b2725ce50448f0931c0cf474d39ee089ac2d0153a9022df` |
| `checkpoint-composition/03-codec-workflow.ajs` |  4830 | `bc1549cad586b27c49963fe017e9a286c9b87a4463425d14034998a838827844` |

The allowlisted `inventory.json` and `checkpoint-composition/results.json` payloads
were not read. Guard count is **38 exact exclusions plus `security/`**; excluded
payload reads, hashes, and executions are **all zero**. Bootstrap metadata is distinct
from functional payloads. One initial stale REPL allowlist binding safely denied an
allowed read before access; the guard was recreated with the initialized allowlist.

Sparse reduction, native expected and current actual:

```json
{
  "dense": { "length": 2, "keys": ["0", "1"], "detached": true },
  "empty": { "length": 2, "keys": [], "detached": true },
  "sparse-value": { "length": 2, "keys": ["1"], "detached": true }
}
```

Dense also passes base. Both sparse cases throw base `TypeError`:
`undefined is not iterable (cannot read property Symbol(Symbol.iterator))`.
The first empty-base harness invocation left that exception uncaught (exit 1);
it is retained, then rerun with harness-level exception recording. The original
algorithm bytes did not change.

Codec fixtures are unchanged `texts: ["", "f", "fo", "foobar"]` and
`texts: ["café", "名称 🧪", "é /𝄞"]`, both with `rejectReview: false`.
Fresh native expectations are established first. Base uninterrupted outputs match
native, but both base capture executions fail with the same TypeError; backend
errors occur at load, prepared, computed, and review. A late review-labeled write
does not make the failed base workflow pass.

Current uninterrupted and checkpointed runs match native complete values, calls,
and outcomes for both fixtures. **Eight intermediate checkpoints** (load, prepared,
computed, review for each fixture) are each resumed twice: **16/16** match complete
native values and outcome ledgers, and their final journals exactly match the
corresponding capture journal. **Four completed resumes**, from two freshly
base-produced and two current-produced snapshots, match native with **zero host
calls** and unchanged final journals. No source adaptations, snapshot field edits,
or version-marker rewrites were used.

`full-original-expected-actual.json` contains full native and actual values, calls,
outcomes, replay ledgers, journals, baseline errors, and metadata graph results.
Individual command JSON records preserve exact argv, exit codes, stdout/stderr;
`checkpoints/` preserves the exact serialized bytes consumed by resumes.

Validation uses a pure deterministic in-memory `exchange` operation, no real LLM or
guest network/filesystem/process operations. Original commands are bounded by
10-second child timeouts, 192 MiB V8 heap, 200000 interpreter steps, call depth 128,
string length 65536, array length 2048, and data size 4000000. Sparse controls use
2000 steps. Disk evidence is host-side validation output, not unit-test fixtures.

### Static review and boundaries

- `graph-depth.ts:76` enumerates array own enumerable data descriptors rather than
  mapping a sparse array and destructuring nonexistent entries.
- `snapshot/arrays.ts:5` selects length/entries when keys are not exactly dense
  indices. `snapshot/arrays.ts:10` preserves explicit undefined, absent indices,
  enumerable named data fields, and length; dense arrays retain the old items shape.
- `snapshot/serialize.ts:522` and `snapshot/dump-format.ts:202` force non-dense arrays
  into the heap even with a single root. Reference discovery includes named entries,
  retaining named-only shared references and cycles.
- `snapshot/restore.ts:505` allocates and registers the complete-length array before
  recursion, then defines only stored entries. This preserves holes and identities.
- `snapshot/validation.ts:523` accepts supported old items records as well as the
  new length/entries records. Review of validation is static, not new security work.
- Dump version remains **1**, execution semantics remains **jobs-v6**. Older inline
  arrays, items heap arrays, and items self-references are independently restored.
  No claim is made that old readers can consume the new representation.

Independent tests additionally cover zero/nonzero all-hole lengths, explicit undefined
versus null, named undefined, named-only mutual cycles, shared roots, self-references,
and two successive capture/restore generations. Unit tests perform no disk IO.
Ordinary object prototype normalization remains intentional; alias checks are strict
identity checks rather than JSON-only comparisons. Existing low-level `Object.values`
host-getter traversal remains a separate pending follow-up, not fixed or probed here.

### Commands and counts

All commands run in the isolated OBJ002 workspace. Recorded Node/Vitest/type commands
unset `TERM`; full test gates explicitly run `env -u TERM npm test`.

| Command                                                                                                                                                                                                                                        | Independent result                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                                                                                                                                                                                                                | Exit 0; 67/67 Turbo tasks cached, then root generation/compilation/bundling complete                                             |
| `env -u TERM node --input-type=module -e <recorded base Vitest transform>`                                                                                                                                                                     | Final 12 failed / 5 passed; expected genuine RED, all five preimages observed                                                    |
| `env -u TERM node_modules/.bin/vitest run packages/safejs/src/snapshot/obj-002-validation.test.ts packages/safejs/src/snapshot/array-shape.test.ts --reporter=verbose`                                                                         | 36 passed, 2 files; initial and final runs                                                                                       |
| `env -u TERM node_modules/.bin/vitest run packages/safejs/src/snapshot packages/safejs/src/interp packages/safejs/src/run.test.ts packages/safejs/src/run.random.test.ts packages/safejs/src/restore.test.ts packages/safejs/src/dump.test.ts` | 1749 passed, 51 files; initial and final runs                                                                                    |
| `env -u TERM npm test`                                                                                                                                                                                                                         | Both runs: 21588 passed / 41 skipped; 938 files passed / 3 skipped; 1 uncached Turbo task each; first 5m24.247s, final 3m55.745s |
| `env -u TERM node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`                                                                                                                                                                  | Exit 0, after full build                                                                                                         |
| `env -u TERM npm run lint:types`                                                                                                                                                                                                               | Exit 0, after full build                                                                                                         |
| `env -u TERM npm run lint:eslint`                                                                                                                                                                                                              | Exit 0; final validator file also passes separately                                                                              |
| `env -u TERM npm run lint:workflows`                                                                                                                                                                                                           | Exit 0                                                                                                                           |
| `env -u TERM node_modules/.bin/prettier --check <all ten publishables>`                                                                                                                                                                        | Exit 0; report formatting normalized with apply_patch and rechecked before capture                                               |
| `env -u TERM git diff --check`                                                                                                                                                                                                                 | Exit 0                                                                                                                           |

The second full gate passes against the final validator test; both full logs are
retained. The full configured suite is not a new security
campaign, but does include existing repository guard tests. No excluded historical
payload is accessed by the validator.

Supplemental command (not a configured gate):

```text
env -u TERM node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --strict packages/safejs/src/snapshot/obj-002-validation.test.ts
```

The final validator file passes. The same command targeting the frozen author
`array-shape.test.ts` has **15 diagnostics**: three optional node-ID arguments and
twelve un-narrowed scope lookup values. This newly recorded **author-test typing
follow-up remains open**; the file is not changed. Configured package/root type gates
exclude tests and pass. This report does not claim every possible TypeScript command
passes; the earlier unrelated legacy 154-diagnostic check was not rerun.

Repository format command:

```text
env -u TERM npm run format -- --ignore-path .gitignore --ignore-path .git/info/exclude '!out/**'
```

Exit 1: **1432 warnings**, every warned working file independently verified byte-for-
byte against its base Git blob; none is a deliverable. The explicit output exclusion
avoids scanning audit/evidence trees. Author's reported 1442 includes ten author-output
JSON paths omitted here. No unrelated formatting was patched. Full path/verification
evidence is in `format-baseline-diagnosis.json`.

## Publication qualification

Runtime evidence supports OBJ002 and named-array metadata/raw graph preservation only.
Regex key order and host-getter differences remain pending; ARRAYOWN call-order and
accessor repair, STR03, NUM/OBJ/COLL and publisher merges need separate integration
checks. The supplemental author-test typing follow-up is not silently waived or called
green. There are no new scoped runtime blockers in the completed checks.

**Verdict: READY for the scoped OBJ002 runtime/configured-gate candidate, with the
explicit supplemental author-test typing follow-up. Not an all-TypeScript-clean or
integrated-publisher verdict.**

Candidate location:
`out/safejs-remediation/obj-002-validation/candidate-20260829-obj002-noether/`.
It contains all eight frozen author files plus the validator test
and this report, five exact modified-file base preimages, and full validation evidence.
Added files have explicit absent-base entries. A relative-path manifest records bytes
and SHA256, verifies every copied file, and seals the candidate read-only/immutable.
The manifest SHA256 is provided in adjacent `manifest.sha256` and the final handoff
(not embedded recursively into this captured report). All eight author source/captured
pairs, five preimages, 62 author artifacts, and the author manifest have been reverified.
Only the two allowed functional audit sources were reverified; **no excluded security
payload was read or hashed**. No production, README, Git, original/shared workspace,
or other-clone mutation was performed. Build-generated font assets already present
at task entry remain untouched. Later merged runtime changes require fresh independent
validation.

## Independent typing-repair rereview — 2026-08-29

**Updated verdict: READY for this OBJ002 candidate; the newly introduced author-test
typing defect is CLOSED, not waived.** This section supersedes only the historical
15-diagnostic typing qualification above. Earlier results, failure logs, candidate,
and non-typing qualifications remain preserved and unchanged.

Fresh frozen author manifest:
`out/safejs-remediation/obj-002-author-test-typing/candidate-20260829-obj002-author-types/manifest.json`,
SHA256 `5857d5a36dd8d39bc8bcdc99d8e8e0f86d53137e389daa45be36e23fb509052c`.
Rereview evidence: `out/safejs-remediation/obj-002-validation/typing-rereview/`.

### Independent scope and assertion review

Compared every fresh author publishable and captured copy to the preceding independently
validated manifest `396ca23c1518e0b6ee8d608fcce41bdb2a184f4101146f4194ff6c4a0950c057`.
Exactly two files differ at rereview entry: the author test and append-only author plan.
All **six production files** and both validator files have identical SHA256 hashes.
The validator test remains unchanged throughout this rereview; only this report gains
the current append-only section.

The test diff introduces an optional-node-ID presence check and a checked scope-binding
reader. Missing nodes or bindings now throw explicitly rather than bypassing checks.
There are no new skips, suppressions, configuration changes, weakened expectations,
or removed assertions. Independent TypeScript AST comparison finds both complete
top-level `describe` trees identical after normalizing only
`readBinding(scope, name)` to `scope.lookup(name).value`. This comparison includes
fixtures, test selectors, names, callbacks, and assertions. The independent traversal
counts **32 `expect` calls before and after**; this is an AST call count, distinct from
the author's reported 31 assertion chains. Manual helper/diff review confirms the
normalization reflects the actual new helper, including its failing presence guard.

Current repaired author test:
`packages/safejs/src/snapshot/array-shape.test.ts`, 8084 bytes, SHA256
`99831f1dc6e0b46da6c637b1ee55440ba721a49865bcd706d9ab303715238765`.
Current append-only author plan: 12536 bytes, SHA256
`5aabfb3a5a9e6a790377237ed82e3696f983dacd219a2a45e48cf19837c70930`.

### Same command, actual closure

```text
env -u TERM node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --strict packages/safejs/src/snapshot/array-shape.test.ts
```

The exact argv array is independently compared to the prior failing command: identical.
Prior result: exit 2, **15 diagnostics**. Current result: exit 0, **zero diagnostics**,
empty stdout and stderr. `prior-author-test-15-diagnostics.json` preserves the original
failure bytes; `author-test-types-green.json` records the independent current execution.
The same strict flags also pass for the unchanged validator test. This closes the
specific newly introduced typing defect without weakening the command or tests.

### Rereview gates and provenance

- Fresh `npm run build`: exit 0; **67 successful / 67 tasks, zero cached**, followed by
  completed root code generation, compilation, wrapper generation, and bundling.
  Build finishes before all TypeScript checks.
- Fresh focused command from the preceding command table: **36 passed / 2 files**.
- Fresh adjacent snapshot/interpreter command from that table: **1749 passed / 51 files**.
- Fresh package and root configured types, both focused strict test-type checks,
  root ESLint, workflow lint, all ten publishables' formatting, and diff check pass.
- `env -u TERM npm test`: exit 0, **one cached Turbo task**. It replays a recorded
  **21588 passed / 41 skipped**, **938 files passed / 3 skipped** result. This is
  explicitly a configured-gate cache replay, **not a fresh independent full execution**.
  The fresh independent focused and adjacent executions provide rereview runtime coverage;
  the two earlier independent uncached full runs remain preserved as historical evidence.
- Repository-wide baseline formatting warnings are not rerun or relabeled green; the
  prior 1432 unchanged-base warnings remain qualified. No unrelated file is reformatted.
- Configuration comparison is clean for `tsconfig.json`, `tsconfig.build.json`,
  `packages/safejs/tsconfig.json`, `vitest.config.ts`, `package.json`, and `turbo.json`.

No original audit payload or bootstrap metadata is reread in this typing-only rereview.
The prior 38-path plus `security/` guard and zero excluded payload reads/hashes/executions
remain intact. Original functional outputs and metadata/raw graph results are **inherited
from the preceding independently validated, identical production bytes**, not claimed
as new executions. No new runtime campaign, security work, real LLM, guest IO,
production edit, Git mutation, or other-clone write occurs.

### Refreshed immutable capture

New candidate:
`out/safejs-remediation/obj-002-validation/typing-rereview/candidate-20260829-obj002-noether-types/`.
Its manifest captures all ten exact current publishables, five base-commit preimages,
and three previous-candidate preimages for the changed author test, author plan, and
appended validator report. It records relative paths, bytes, and SHA256, retains prior
15-diagnostic failure evidence and both parent manifests, and preserves the previous
functional output evidence with explicit inherited provenance. Copies are verified
before sealing files 0444/directories 0555 with macOS `uchg`; the manifest digest is
provided in `manifest.sha256` and the final handoff, avoiding a self-referential report hash.

The prior immutable candidate is not overwritten or unsealed. Regex own-key ordering
and ordinary host-getter follow-ups remain pending. ARRAYOWN accessor/call-order and
publisher integration are separate; no merged ARRAYOWN work starts under this handoff.
Later integrated runtime changes still require their own freeze and independent validation.

## Independent merged OBJ002 validation — 2026-08-29

### Current verdict and ownership

**READY for this exact merged OBJ002 candidate on f5dc9fac, not a release or future NUM001 combination.** This section records fresh independent work in /Users/kjopek/Workspace/poe-code-safejs-sparse-checkpoint-integrated. Earlier sections and their failures/captures remain historical and unchanged. The root coordinates; this delegated worker performs the validation directly.

- Current HEAD: f5dc9facc00e03fd2ade2af650b25bda7dc43068, unchanged throughout. ARRAY commit 7fec2826bac2933483c2579ff47d2264f8e1f422 and the COLL typing repair are present. No pull, fetch, index, branch, commit, push, or other Git mutation was performed.
- Frozen author manifest: out/safejs-remediation/obj-002-integration/manifest.json, SHA-256 e6916e102f5e52bd75cee392f122ef7a821e68f3bc610f8cdbbe10df0150917c. Boyle's source, tests, plan, and captured evidence remain unchanged.
- The only edited publishable is this validator plan, by appending this section. All previous clones/captures are read-only. No production, test, README, master-ledger, or other-clone edits; no NUM merge.
- Independent reference capture: out/safejs-remediation/obj-002-integrated-validation/candidate-20260829-f5dc9fac-noether/. Evidence paths in this section are relative to that capture. Ten exact publishables plus five present current-base preimages are pinned; the other five paths are explicitly absent at HEAD.

### Three-way and upstream preservation

Independently compared all ten working publishables against the frozen author copies and hashes. The five existing production target preimages exactly match git show f5dc9fac:<path> and the historical 33c73a21 preimages. Thus the merged source is the same incoming repair on unchanged target-file bases: zero textual conflicts, no overwritten intervening hunks. All six production files and both tests are byte-identical to the previously independently validated incoming typing-repair candidate. The incoming validator report was also byte-identical before this append; only the integration author's plan already had its authorized appendix.

All **37 protected upstream source/plan files** independently match current HEAD and author preservation hashes. All nine listed feature commits are ancestors of HEAD: ARRAY, COLL, COLL_TYPES, OBJ001, MC003, MC001, TREE, HI, STR03. This establishes source ancestry and preservation, not a new registry/latest-version claim.

The published-feature run reexecutes **20 files / 1,254 tests**, including unchanged ARRAY own-metadata tests **12+14=26**, generic call-order **15**, and COLL iteration/cursor **112+24=136**. The larger current interpreter, parser, array methods, object-alias, constants, replacement, lint, and Markdown-offset regressions are included; no existing assertion was changed.

### Genuine RED, GREEN and typing history

- Independent current-base RED: the unchanged author and validator tests run with an in-memory Vitest pre-transform supplying the exact five HEAD production preimages, without changing working files. All five modules were observed through the transform. **26 fail / 10 pass / 36 total**. This is the validator's own run, distinct from Boyle's earlier physical-base RED.
- Same unchanged tests against merged source: **36 pass** (19 author, 17 validator).
- Original author-test typing failure remains in evidence/history/prior-author-test-15-diagnostics.json: **15 diagnostics, exit2**, SHA-256 ab967afefab115791f896ee6baf2acfccc58be7d90d42b45a35a43e70ea4ee7e. Its subsequent same-command zero proof remains in evidence/history/author-test-types-green.json, SHA-256 8a9aa9d6cde3000feb97a6a35cc77c55ee9d127d000e67eae33b5d7315dbf7ff. These are preserved historical receipts, not newly repeated RED typing runs.
- Fresh identical supplemental commands for array-shape.test.ts and obj-002-validation.test.ts both exit0 with **zero diagnostics**. No compiler flags or test roots were weakened.
- Reviewed the old/current typing diff and compared all **31 direct author assertion expressions** through TypeScript ASTs, normalizing only lookup(name).value into the guarded readBinding(scope,name) spelling. Matchers and expected values remain identical; the added node-ID and binding-presence checks throw on invalid setup. The merged tests are byte-identical to the repaired incoming tests.
- Earlier 17 validator diagnostics, the author's original 14-failure functional RED, prototype-expectation correction, and all ARRAY call-order history remain preserved in prior reports/captures. This does not claim every possible unconfigured TypeScript command passes; the historical legacy interpreter-test diagnostic command was not rerun or promoted into a configured gate.

### Static representation and runtime boundaries

- graph-depth.ts:77 now uses present own data descriptors for arrays, avoiding sparse iteration holes while discovering named entry references. It preserves existing ordinary-object traversal.
- snapshot/arrays.ts selects existing dense items encoding or length+entries for sparse/named arrays. Present undefined entries are serialized; absent indices remain absent; length is stored independently.
- snapshot/serialize.ts:440 and snapshot/dump-format.ts:162 share this representation. Reference discovery includes named entries, and sparse/named single-use arrays receive heap identities rather than lossy inline encoding.
- snapshot/restore.ts:505 allocates and registers an array at its declared length before recursively restoring entries, preserving cycles and shared references without densification.
- snapshot/validation.ts:523 accepts both supported representations, retains the existing validation traversal, and rejects contradictory shape fields through the existing guard. This was static functional review, not a new security/probe matrix.
- The unchanged validator tests cover interpreter and dump paths, all-hole lengths0/2/9, holes versus explicit undefined/null and named undefined, named-only references, mutual cycles, alias roots, two captures, older inline arrays, older heap-items arrays and an old items self-reference. Current dump version1 and executionSemantics jobs-v6 remain unchanged; no source/version marker was rewritten.
- Backward compatibility means reading supported stored inline/items representations. It does not recover hole/metadata information already lost by an older writer, certify old readers consuming new records, or promise nonenumerables, symbols, accessors, descriptor flags, frozen/sealed arrays, or arbitrary ECMAScript behavior.

### Exact metadata/raw observation now resolved in this candidate

The original ARRAYOWN companion was an **additional unasserted observation**, not one of its five call-order failures. Its complete command, failing output and snapshot remain in evidence/history/metadata-observation.json. Expected input graph: metadata={count:5}, rows=Object.assign([metadata],{metadata,raw:metadata}), object={metadata,raw:metadata}, roots rows/alias/metadata/object.

The **unchanged original witness command was executed twice** here. Both results match every original graph assertion:

| Field                                | Historical failing actual | Fresh merged expected/actual |
| ------------------------------------ | ------------------------- | ---------------------------- |
| arrayAlias                           | true                      | true                         |
| indexAlias                           | true                      | true                         |
| metadataAlias                        | false                     | true                         |
| rawAlias                             | false                     | true                         |
| ownMetadata                          | false                     | true                         |
| keys                                 | [0]                       | [0,metadata,raw]             |
| ordinary object metadata/raw aliases | true                      | true                         |

The independent native input-graph control also verifies the ordinary object's raw alias. There is no native checkpoint API: native supplies graph/value expectations. Both serializer paths, named-only reachability, cycles and multi-capture aliases are asserted by the unchanged 36-test suite. This fixes the named-array checkpoint-loss witness **only in the sealed candidate**; it does not silently close regex key ordering or host-getter bookkeeping.

### Unmodified original functional results

First established fresh native expectations and checked them against the original stored expectations for codec-ascii and codec-unicode. Both unchanged original source strings are injected verbatim into bounded inline host checks; no guest source adaptation, reduction, new version marker, network, filesystem, process capability or real LLM is introduced. All snapshots/backends/gates operate in memory. Host command input/output and full serialized snapshots are retained as JSON evidence, not a new executable QA runner.

- **Two native codec fixtures**, two fresh merged complete capture executions, **eight intermediate checkpoints** (load/prepared/computed/review for each fixture), **sixteen intermediate resumes** (each boundary twice), and **four completed resumes**: one author-captured current-base completed checkpoint and one fresh merged completed checkpoint per fixture.
- Every full result matches native, including byte arrays/base64/decoded text, URL-safe bytes, packet/byte aliases, closure-returned value, receipts, receipt alias and phaseCount. No result fields or tolerances are dropped.
- Every intermediate resume has the exact expected native host-call suffix and complete outcome ledger. Its **entire final replay object**, including IDs and stored fields, equals the originating execution's final replay object. Every completed resume makes zero new host calls and preserves its **exact input completed replay object**. Cross-execution random IDs are not interchangeable; see retained oracle failure below.
- All eight intermediate snapshots contain the exact original sparse reverseLookup: length123, **66 present indices**, and every stored value matches the original alphabet/+/-/\_ mapping. Missing indices remain holes in the new length+entries encoding.
- Three unchanged structured-sparse originals match complete native data outputs:

| Original caseName | Native expected and current actual  |
| ----------------- | ----------------------------------- |
| dense             | {length:2,keys:[0,1],detached:true} |
| empty-sparse      | {length:2,keys:[],detached:true}    |
| sparse-value      | {length:2,keys:[1],detached:true}   |

The original codec/sparse data outputs and all raw snapshots/journals appear in evidence/commands/original-\*.json; evidence/original-verification.json indexes all comparisons. Public sandbox records intentionally have no prototype; comparing data output does not certify native prototypes. Dedicated graph tests retain own-presence and identity assertions rather than JSON-normalizing sparse arrays.

Budgets follow the captured finite protocol: maxSteps200000, maxCallDepth128, stringLength65536, arrayLength2048, dataSize4000000, five-second deadline and ten-second outer child bound. A controlled logical capture clock advances only at four fake host gates; real wall time is still bounded by the parent. Native child has a five-second outer bound and sparse vm checks a one-second timeout. The host harness replaces only its own disk reads with already guard-read in-memory source/snapshot inputs. Each current original resume runs in its own bounded child. The historical protocol's failed-gate cleanup correction is retained, not silently credited as a new success.

### Preserved independent helper failures

1. The first completed current-base replay comparison incorrectly compared its journal IDs with a separately created fresh merged execution. IDs correctly differed (906dac5d… versus 61c97698…). Result values, native ledger and zero-call suffix already matched. The oracle was corrected to compare the **entire exact input capture's replay object**, without deleting/normalizing IDs or rerunning the first child. All four completed comparisons then pass. Raw receipt and failure details remain in evidence/helper-failures.json.
2. The initial sparse-original helper used Node deepStrictEqual on a null-prototype sandbox return record versus a normal native record; its first comparison exited1 although all data fields matched. A corrected helper compares the complete JSON data record, consistent with the documented prototype-free public boundary. Guest source, fixture values, keys, length and detachment assertions are unchanged. All three corrected outputs pass. The failed helper and corrected command remain separate receipts, not an erased failure.

Neither correction edits production, frozen tests, original source, version markers or expected graph assertions. They are comparison-helper failures, not newly discovered product blockers and not waived runtime regressions.

### Actual independent gates

All gate commands run in this clone with TERM unset. The first build was an honest 67-task cache hit; it was followed by a forced fresh **67/67, zero-cache build** before configured type checks. The full test gate is also forced and uncached.

| Command                                                                                                                                                                                                                                      | Actual result                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| env -u TERM node --input-type=module; inline Vitest exact-preimage transform                                                                                                                                                                 | exit1; 26 failed / 10 passed; five genuine base modules observed                                   |
| env -u TERM node_modules/.bin/vitest run packages/safejs/src/snapshot/obj-002-validation.test.ts packages/safejs/src/snapshot/array-shape.test.ts --reporter=verbose                                                                         | exit0; 36 passed                                                                                   |
| env -u TERM node_modules/.bin/vitest run packages/safejs/src/snapshot packages/safejs/src/interp packages/safejs/src/run.test.ts packages/safejs/src/run.random.test.ts packages/safejs/src/restore.test.ts packages/safejs/src/dump.test.ts | exit0; 1,925 passed / 55 files                                                                     |
| env -u TERM node_modules/.bin/vitest run [20 exact published paths recorded in command receipt]                                                                                                                                              | exit0; 1,254 passed / 20 files; ARRAY26+15, COLL136 included                                       |
| env -u TERM TURBO_FORCE=true npm run build                                                                                                                                                                                                   | exit0; 67 tasks, zero cached; root codegen/type compilation/bundle completes                       |
| env -u TERM TURBO_FORCE=true npm test                                                                                                                                                                                                        | exit0; 21,977 passed / 41 skipped; 949 files passed / 3 skipped; one uncached task; Turbo3m43.958s |
| env -u TERM node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --strict packages/safejs/src/snapshot/array-shape.test.ts                                                            | exit0; zero diagnostics                                                                            |
| Same exact supplemental flags, packages/safejs/src/snapshot/obj-002-validation.test.ts                                                                                                                                                       | exit0; zero diagnostics                                                                            |
| env -u TERM node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit                                                                                                                                                                  | exit0; zero diagnostics                                                                            |
| env -u TERM npm run lint:types                                                                                                                                                                                                               | exit0; configured root types                                                                       |
| env -u TERM npm run lint:eslint                                                                                                                                                                                                              | exit0                                                                                              |
| env -u TERM npm run lint:workflows                                                                                                                                                                                                           | exit0                                                                                              |
| env -u TERM node_modules/.bin/prettier --check [all ten publishables]                                                                                                                                                                        | exit0; repeated after this append                                                                  |
| env -u TERM git diff --check                                                                                                                                                                                                                 | exit0; repeated after this append                                                                  |

These suites overlap; counts are not summed into a new total. Full configured regression coverage is not a new security campaign or universal compatibility claim. The author-reported **1,435 unrelated repository-wide formatting warnings** remain qualified; that global formatting command was not rerun or patched. Preexisting generated terminal-pilot font assets remain untouched and are excluded from this candidate. No CLI visual change requires screenshots.

### Original-input boundary and current hashes

Freshly bootstrapped only inventory-verification.json metadata before original payload access: SHA-256 2ff2b353edf16714ee705dd550903a11bae70e1d7a544357de81d540b13ff827. Restored archiveReadPolicy.excludedPaths **38 exact paths**, ordered-list SHA-256 31d6082a11baf18b246ccaa0843e8aa488f1a289348a7a5c24b6e19cbd3b0c13, plus entire security/ and outside-cohort dynamic-deflate-provenance-review/. Every subsequent original read required explicit allowlist membership and normalized containment/deny checks.

**Three allowed historical functional audit inputs plus one bootstrap metadata file read; zero excluded payload reads, hashes or executions; zero original writes or recursive audit searches.** These are functional audit inputs, not a claim that all archive bytes were reverified.

| Allowed input                                |    Bytes | SHA-256                                                          |
| -------------------------------------------- | -------: | ---------------------------------------------------------------- |
| objects/reductions/structured-sparse.ajs     |      261 | e873c44afa16870b1b2725ce50448f0931c0cf474d39ee089ac2d0153a9022df |
| checkpoint-composition/03-codec-workflow.ajs |     4830 | bc1549cad586b27c49963fe017e9a286c9b87a4463425d14034998a838827844 |
| checkpoint-composition/results.json          | 11764391 | a22fdd90f85d8dc4c6586da9cc4b89ff9899d1d420ec32178d44cca3d4563e7f |

No additional original read is needed for publication from these captured bytes. Later changes requiring different inputs must restore the guard and obtain their own concrete allowlist.

### Remaining scope and NUM001 overlap

- **Known exact overlap:** packages/safejs/src/snapshot/restore.ts is shared with NUM001's separately frozen manifest /Users/kjopek/Workspace/poe-code-safejs-function-arity/out/safejs-remediation/num-001-validation/candidate/manifest.json, SHA-256 ab188c65b988fbc10a93802350ef6c2a33c980d9d7855ed9f8571c9560c7e6b1. Only that manifest was inspected for overlap; no NUM source was applied or combined runtime run.
- Coordinator/publisher must reconcile that file against actual new preimages and obtain fresh independent integrated checks preserving both closure arity/restoration and sparse/named array reconstruction. **Future NUM combination is not covered by this READY.**
- Regex own-key ordering and ordinary-host-getter/G01 bookkeeping remain separate pending functional follow-ups. No new getter or security probes were added. Existing ARRAY own-property/call-order and COLL cursor behavior is preserved and retested here, but this is not all ARRAY/regex functionality certification.
- The exact named-array metadata/raw loss is resolved in this candidate, not automatically in another clone or release. No current npm latest, publisher intake completion, push, or release claim is made.

### Exact candidate and seal

The reference capture contains the ten current publishables (six production, two tests, two plans), five exact current-base preimages, explicit absence for five added paths, the inherited validator report before this append, prior typing RED/GREEN and metadata failure records, full independent command receipts, native/current outputs, snapshots and manifest evidence. Relative paths, byte counts and SHA-256 hashes identify every captured file. Copies are verified before and after read-only/macOS uchg sealing. No earlier candidate is overwritten.

The author manifest remains frozen; a new independent manifest pins the appended validator report. Only this appendix is added to the inherited report, with its original prefix byte-for-byte preserved. Final manifest SHA-256 is returned in the coordinator handoff, not recursively embedded in itself. Publisher must verify current preimages before intake and perform required fresh integrated gates for any later combination.
